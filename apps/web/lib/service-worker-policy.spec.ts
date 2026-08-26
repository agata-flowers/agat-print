import { describe, expect, it } from "vitest";
import { isSensitiveRequest } from "./service-worker-policy";
describe("PWA cache denylist", () => {
  it.each([
    "/api/v1/profile",
    "/auth/login",
    "/documents/a",
    "/x?X-Amz-Signature=secret",
  ])("never caches %s", (path) =>
    expect(isSensitiveRequest(new URL(path, "https://agat.example"))).toBe(
      true,
    ),
  );
  it("allows versioned public assets", () =>
    expect(
      isSensitiveRequest(
        new URL("/_next/static/app.123.js", "https://agat.example"),
      ),
    ).toBe(false));
});
