import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { PaymentProvider, ProviderContext } from "@agat/providers";
import type { AppEnvironment } from "../config/environment";
import { APP_ENVIRONMENT } from "../uploads/private-object-storage.service";

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  constructor(@Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment) {}

  start(
    _orderReference: string,
    _amountMinor: bigint,
    _currency: "UZS",
    context: ProviderContext,
  ): Promise<{ reference: string }> {
    return Promise.resolve({
      reference: this.reference("pay", context.idempotencyKey),
    });
  }

  refund(
    _paymentReference: string,
    _amountMinor: bigint,
    context: ProviderContext,
  ): Promise<{ reference: string }> {
    return Promise.resolve({
      reference: this.reference("refund", context.idempotencyKey),
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

  private reference(prefix: string, idempotencyKey: string): string {
    return createHash("sha256")
      .update(`${prefix}:${idempotencyKey}`)
      .digest("hex");
  }
}
