import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  PaymentProvider,
  PaymentWebhookEvent,
  ProviderContext,
} from "@agat/providers";
import { loadEnvironment } from "../config/environment";
import { HttpProviderClient } from "../providers/http-provider.client";

@Injectable()
export class HttpPaymentProvider implements PaymentProvider {
  private client() {
    const env = loadEnvironment();
    return new HttpProviderClient(
      env.paymentProviderEndpoint,
      env.paymentProviderApiKey,
      env.providerTimeoutSeconds,
    );
  }

  async start(
    orderReference: string,
    amountMinor: bigint,
    currency: "UZS",
    context: ProviderContext,
  ) {
    const result = await this.client().post<{ reference: unknown }>(
      "payments",
      { orderReference, amountMinor: amountMinor.toString(), currency },
      context,
    );
    return { reference: this.client().assertReference(result.reference) };
  }

  async refund(
    paymentReference: string,
    amountMinor: bigint,
    context: ProviderContext,
  ) {
    const result = await this.client().post<{ reference: unknown }>(
      "refunds",
      {
        paymentReference,
        amountMinor: amountMinor.toString(),
        currency: "UZS",
      },
      context,
    );
    return { reference: this.client().assertReference(result.reference) };
  }

  async confirm(paymentReference: string, context: ProviderContext) {
    const result = await this.client().post<{
      status: "PENDING" | "SUCCEEDED" | "FAILED";
    }>("payments/confirm", { paymentReference }, context);
    if (!["PENDING", "SUCCEEDED", "FAILED"].includes(result.status))
      throw new Error("PROVIDER_RESPONSE_INVALID");
    return result;
  }

  async status(reference: string, context: ProviderContext) {
    const result = await this.client().post<{
      status: "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";
      amountMinor: string;
      currency: "UZS";
    }>("payments/status", { reference }, context);
    if (
      !/^[0-9]{1,18}$/.test(result.amountMinor) ||
      result.currency !== "UZS" ||
      !["PENDING", "SUCCEEDED", "FAILED", "REFUNDED"].includes(result.status)
    )
      throw new Error("PROVIDER_RESPONSE_INVALID");
    return { ...result, amountMinor: BigInt(result.amountMinor) };
  }

  parseWebhook(
    payload: string,
    signature: string | undefined,
  ): PaymentWebhookEvent | null {
    const secret = loadEnvironment().paymentWebhookSecret;
    if (!signature || !/^[a-f0-9]{64}$/.test(signature) || !secret) return null;
    const expected = Buffer.from(
      createHmac("sha256", secret).update(payload).digest("hex"),
      "hex",
    );
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return null;
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
}
