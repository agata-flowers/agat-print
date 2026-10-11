import { describe, expect, it, vi } from "vitest";
import { disableProxyTrust } from "./http-server-policy";

describe("HTTP server security policy", () => {
  it("does not trust client-controlled forwarding headers", () => {
    const set = vi.fn();

    disableProxyTrust({ set });

    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith("trust proxy", false);
  });

  it("fails closed when the HTTP adapter cannot enforce the policy", () => {
    expect(() => disableProxyTrust({})).toThrow(
      "HTTP adapter cannot enforce proxy trust policy",
    );
  });
});
