import { describe, expect, it } from "vitest";
import { createApiClient, SafeApiError } from "./index.js";

describe("shared API client foundation", () => {
  it("returns typed JSON through an injected transport", async () => {
    const client = createApiClient(() =>
      Promise.resolve(Response.json({ status: "ok" })),
    );
    await expect(
      client.request<{ status: string }>("/health"),
    ).resolves.toEqual({ status: "ok" });
  });

  it("normalizes untrusted server errors to a bounded code", async () => {
    const client = createApiClient(() =>
      Promise.resolve(
        Response.json({ code: "raw stack and private value" }, { status: 500 }),
      ),
    );
    await expect(client.request("/unsafe")).rejects.toEqual(
      new SafeApiError(500, "REQUEST_FAILED"),
    );
  });
});
