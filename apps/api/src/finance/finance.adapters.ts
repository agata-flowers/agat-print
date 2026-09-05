import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  FiscalProvider,
  PayoutProvider,
  ProviderContext,
} from "@agat/providers";
import { loadEnvironment } from "../config/environment";
import { HttpProviderClient } from "../providers/http-provider.client";

const ref = (prefix: string, key: string) =>
  createHash("sha256").update(`${prefix}:${key}`).digest("hex");

@Injectable()
export class MockFiscalProvider implements FiscalProvider {
  submit(
    _operation: Parameters<FiscalProvider["submit"]>[0],
    context: ProviderContext,
  ) {
    return Promise.resolve({
      reference: ref("fiscal", context.idempotencyKey),
      receiptReference: ref("receipt", context.idempotencyKey),
      issuedAt: new Date(),
    });
  }
  status() {
    return Promise.resolve({ status: "CONFIRMED" as const });
  }
}

@Injectable()
export class HttpFiscalProvider implements FiscalProvider {
  private client() {
    const env = loadEnvironment();
    return new HttpProviderClient(
      env.fiscalProviderEndpoint,
      env.fiscalProviderApiKey,
      env.providerTimeoutSeconds,
    );
  }
  async submit(
    operation: Parameters<FiscalProvider["submit"]>[0],
    context: ProviderContext,
  ) {
    const result = await this.client().post<{
      reference: unknown;
      receiptReference: unknown;
      issuedAt: string;
    }>(
      "fiscal/operations",
      {
        ...operation,
        amountMinor: operation.amountMinor.toString(),
      },
      context,
    );
    const issuedAt = new Date(result.issuedAt);
    if (Number.isNaN(issuedAt.getTime()))
      throw new Error("PROVIDER_RESPONSE_INVALID");
    return {
      reference: this.client().assertReference(result.reference),
      receiptReference: this.client().assertReference(result.receiptReference),
      issuedAt,
    };
  }
  async status(reference: string, context: ProviderContext) {
    const result = await this.client().post<{
      status: "PENDING" | "CONFIRMED" | "FAILED";
    }>("fiscal/status", { reference }, context);
    if (!["PENDING", "CONFIRMED", "FAILED"].includes(result.status))
      throw new Error("PROVIDER_RESPONSE_INVALID");
    return result;
  }
}

@Injectable()
export class MockPayoutProvider implements PayoutProvider {
  private readonly amounts = new Map<string, bigint>();
  submitBatch(
    _batchReference: string,
    _partnerReference: string,
    _amountMinor: bigint,
    _currency: "UZS",
    context: ProviderContext,
  ) {
    const reference = ref("payout", context.idempotencyKey);
    this.amounts.set(reference, _amountMinor);
    return Promise.resolve({ reference });
  }
  status(reference: string) {
    return Promise.resolve({
      status: "SETTLED" as const,
      amountMinor: this.amounts.get(reference) ?? 0n,
      currency: "UZS" as const,
    });
  }
}

@Injectable()
export class HttpPayoutProvider implements PayoutProvider {
  private client() {
    const env = loadEnvironment();
    return new HttpProviderClient(
      env.payoutProviderEndpoint,
      env.payoutProviderApiKey,
      env.providerTimeoutSeconds,
    );
  }
  async submitBatch(
    batchReference: string,
    partnerReference: string,
    amountMinor: bigint,
    currency: "UZS",
    context: ProviderContext,
  ) {
    const result = await this.client().post<{ reference: unknown }>(
      "payouts/batches",
      {
        batchReference,
        partnerReference,
        amountMinor: amountMinor.toString(),
        currency,
      },
      context,
    );
    return { reference: this.client().assertReference(result.reference) };
  }
  async status(reference: string, context: ProviderContext) {
    const result = await this.client().post<{
      status: "PENDING" | "SETTLED" | "FAILED";
      amountMinor: string;
      currency: "UZS";
    }>("payouts/status", { reference }, context);
    if (
      !/^[0-9]{1,18}$/.test(result.amountMinor) ||
      result.currency !== "UZS" ||
      !["PENDING", "SETTLED", "FAILED"].includes(result.status)
    )
      throw new Error("PROVIDER_RESPONSE_INVALID");
    return { ...result, amountMinor: BigInt(result.amountMinor) };
  }
}
