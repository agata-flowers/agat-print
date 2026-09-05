import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  PaymentProvider,
  PaymentWebhookEvent,
  ProviderContext,
} from "@agat/providers";
import type { AppEnvironment } from "../config/environment";
import { APP_ENVIRONMENT } from "../uploads/private-object-storage.service";

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  private readonly operations = new Map<
    string,
    {
      status: "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";
      amountMinor: bigint;
    }
  >();
  private readonly refundParents = new Map<string, string>();
  private readonly refundedAmounts = new Map<string, bigint>();
  constructor(@Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment) {}

  start(
    _orderReference: string,
    amountMinor: bigint,
    _currency: "UZS",
    context: ProviderContext,
  ): Promise<{ reference: string }> {
    const reference = this.reference("pay", context.idempotencyKey);
    this.operations.set(reference, { status: "PENDING", amountMinor });
    return Promise.resolve({ reference });
  }

  refund(
    paymentReference: string,
    amountMinor: bigint,
    context: ProviderContext,
  ): Promise<{ reference: string }> {
    const reference = this.reference("refund", context.idempotencyKey);
    this.operations.set(reference, { status: "PENDING", amountMinor });
    this.refundParents.set(reference, paymentReference);
    return Promise.resolve({ reference });
  }

  confirm(reference: string): Promise<{
    status: "PENDING" | "SUCCEEDED" | "FAILED";
  }> {
    const status = this.operations.get(reference)?.status ?? "PENDING";
    return Promise.resolve({
      status: status === "REFUNDED" ? "SUCCEEDED" : status,
    });
  }

  sign(payload: string): string {
    return createHmac("sha256", this.env.mockPaymentSecret)
      .update(payload)
      .digest("hex");
  }

  verify(payload: string, signature: string | undefined): boolean {
    if (!signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
    const expected = Buffer.from(this.sign(payload), "hex");
    const supplied = Buffer.from(signature, "hex");
    return timingSafeEqual(expected, supplied);
  }

  parseWebhook(
    payload: string,
    signature: string | undefined,
  ): PaymentWebhookEvent | null {
    if (!this.verify(payload, signature)) return null;
    return parsePaymentWebhook(payload);
  }

  status(reference: string): Promise<{
    status: "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";
    amountMinor: bigint;
    currency: "UZS";
  }> {
    const operation = this.operations.get(reference) ?? {
      status: "PENDING" as const,
      amountMinor: 0n,
    };
    return Promise.resolve({ ...operation, currency: "UZS" });
  }

  recordOutcome(
    reference: string,
    outcome: "PAYMENT_SUCCEEDED" | "PAYMENT_FAILED" | "REFUND_SUCCEEDED",
  ): void {
    const prior = this.operations.get(reference);
    if (!prior) return;
    this.operations.set(reference, {
      ...prior,
      status:
        outcome === "PAYMENT_SUCCEEDED"
          ? "SUCCEEDED"
          : outcome === "PAYMENT_FAILED"
            ? "FAILED"
            : "REFUNDED",
    });
    if (outcome === "REFUND_SUCCEEDED") {
      const parentReference = this.refundParents.get(reference);
      const parent = parentReference
        ? this.operations.get(parentReference)
        : undefined;
      const refunded = parentReference
        ? (this.refundedAmounts.get(parentReference) ?? 0n) + prior.amountMinor
        : 0n;
      if (parentReference) this.refundedAmounts.set(parentReference, refunded);
      if (parent && refunded >= parent.amountMinor)
        this.operations.set(parentReference!, {
          ...parent,
          status: "REFUNDED",
        });
    }
  }

  private reference(prefix: string, idempotencyKey: string): string {
    return createHash("sha256")
      .update(`${prefix}:${idempotencyKey}`)
      .digest("hex");
  }
}

function parsePaymentWebhook(payload: string): PaymentWebhookEvent | null {
  try {
    const value = JSON.parse(payload) as Record<string, unknown>;
    if (
      typeof value.eventId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.eventId,
      ) ||
      typeof value.paymentReference !== "string" ||
      !/^[A-Za-z0-9._:-]{1,160}$/.test(value.paymentReference) ||
      !["PAYMENT_SUCCEEDED", "PAYMENT_FAILED", "REFUND_SUCCEEDED"].includes(
        String(value.outcome),
      )
    )
      return null;
    return value as unknown as PaymentWebhookEvent;
  } catch {
    return null;
  }
}
