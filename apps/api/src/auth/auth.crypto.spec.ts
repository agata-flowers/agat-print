import { describe, expect, it } from "vitest";
import {
  digest,
  normalizePhone,
  randomToken,
  safeDigestEqual,
} from "./auth.crypto";

describe("auth crypto", () => {
  it("hashes and compares secrets without storing plaintext", () => {
    const secret = randomToken();
    expect(secret.length).toBeGreaterThan(32);
    expect(safeDigestEqual(secret, digest(secret))).toBe(true);
    expect(safeDigestEqual(`${secret}x`, digest(secret))).toBe(false);
  });
  it("normalizes Uzbek phone numbers", () => {
    expect(normalizePhone("+998 90 123 45 67")).toBe("+998901234567");
    expect(() => normalizePhone("901234567")).toThrow();
  });
});
