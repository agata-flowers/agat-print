import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const digest = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
export const randomToken = (): string => randomBytes(32).toString("base64url");
export const safeDigestEqual = (
  value: string,
  expectedDigest: string,
): boolean => {
  const actual = Buffer.from(digest(value), "hex");
  const expected = Buffer.from(expectedDigest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
export const normalizePhone = (value: string): string => {
  const normalized = value.replace(/[\s()-]/g, "");
  if (!/^\+998\d{9}$/.test(normalized))
    throw new Error("Phone must use +998XXXXXXXXX format");
  return normalized;
};
