import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AppEnvironment } from "../config/environment";
import { MockPaymentProvider } from "./mock-payment.provider";

const provider = () =>
  new MockPaymentProvider({
    mockPaymentSecret: "development-only-mock-payment-secret",
  } as AppEnvironment);

const attempt = (scenario: "SUCCESS" | "FAILURE" | "RETRY" | "TIMEOUT") => ({
  orderReference: randomUUID(),
  merchantReference: randomUUID(),
  method: "INTERNAL_MVP" as const,
  amountMinor: 12_000n,
  currency: "UZS" as const,
  scenario,
});

describe("Stage 14 deterministic payment adapter", () => {
  it("returns stable references and authoritative outcomes", async () => {
    const adapter = provider();
    const input = attempt("SUCCESS");
    const first = await adapter.createAttempt(input);
    const replay = await adapter.createAttempt(input);
    expect(replay.reference).toBe(first.reference);
    await expect(adapter.status(first.reference)).resolves.toMatchObject({
      status: "SUCCEEDED",
      amountMinor: 12_000n,
      currency: "UZS",
    });
  });

  it("makes retry deterministic and keeps timeout non-terminal", async () => {
    const adapter = provider();
    const retry = attempt("RETRY");
    await expect(adapter.createAttempt(retry)).rejects.toThrow(
      "PROVIDER_TEMPORARY_FAILURE",
    );
    await expect(adapter.createAttempt(retry)).resolves.toMatchObject({
      status: "PROCESSING",
    });
    const timeout = await adapter.createAttempt(attempt("TIMEOUT"));
    expect(timeout.status).toBe("UNKNOWN");
    await expect(adapter.status(timeout.reference)).resolves.toMatchObject({
      status: "PENDING",
    });
  });
});
