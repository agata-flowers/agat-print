import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpProviderClient } from "./http-provider.client";

describe("HttpProviderClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends bounded idempotency context and validates references", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ reference: "provider-ref_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new HttpProviderClient(
      "https://provider.invalid/v1/",
      "synthetic-secret",
      5,
    );
    const result = await client.post<{ reference: string }>(
      "payments",
      { amountMinor: "1250", currency: "UZS" },
      {
        idempotencyKey: "a".repeat(64),
        correlationId: "synthetic-correlation",
      },
    );
    expect(client.assertReference(result.reference)).toBe("provider-ref_1");
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((request.headers as Record<string, string>)["idempotency-key"]).toBe(
      "a".repeat(64),
    );
    expect(() =>
      client.assertReference("invalid reference with spaces"),
    ).toThrow("PROVIDER_RESPONSE_INVALID");
  });

  it("fails closed on provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 503 })),
    );
    await expect(
      new HttpProviderClient(
        "https://provider.invalid/",
        "synthetic-secret",
        5,
      ).post(
        "otp/send",
        {},
        { idempotencyKey: "b".repeat(64), correlationId: "synthetic" },
      ),
    ).rejects.toThrow("PROVIDER_REQUEST_FAILED");
  });
});
