import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { HttpPaymentProvider } from "./http-payment.provider";

describe("HttpPaymentProvider webhook authentication", () => {
  const previous = process.env.PAYMENT_WEBHOOK_SECRET;
  const previousJwt = process.env.JWT_ACCESS_SECRET;
  afterEach(() => {
    if (previous === undefined) delete process.env.PAYMENT_WEBHOOK_SECRET;
    else process.env.PAYMENT_WEBHOOK_SECRET = previous;
    if (previousJwt === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = previousJwt;
  });

  it("accepts only an exact HMAC and rejects malformed signatures", () => {
    process.env.PAYMENT_WEBHOOK_SECRET =
      "synthetic-webhook-secret-for-unit-test";
    process.env.JWT_ACCESS_SECRET =
      "synthetic-jwt-secret-at-least-32-characters";
    const event = {
      eventId: "00000000-0000-4000-8000-000000000001",
      paymentReference: "pay_test",
      outcome: "PAYMENT_SUCCEEDED",
    } as const;
    const payload = JSON.stringify(event);
    const signature = createHmac("sha256", process.env.PAYMENT_WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");
    const provider = new HttpPaymentProvider();
    expect(provider.parseWebhook(payload, signature)).toEqual(event);
    expect(provider.parseWebhook(`${payload}\n`, signature)).toBeNull();
    expect(provider.parseWebhook(payload, "0".repeat(64))).toBeNull();
    expect(provider.parseWebhook(payload, "invalid")).toBeNull();
  });
});
