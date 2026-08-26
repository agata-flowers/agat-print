import { describe, expect, it } from "vitest";
import { loadEnvironment } from "./environment";

const base = {
  JWT_ACCESS_SECRET: "x".repeat(32),
  WEB_ORIGIN: "http://localhost:3000",
};

describe("environment validation", () => {
  it("allows the mock provider in development", () => {
    expect(
      loadEnvironment({
        ...base,
        NODE_ENV: "development",
        OTP_PROVIDER: "mock",
      }).otpProvider,
    ).toBe("mock");
  });
  it("rejects mock OTP in production", () => {
    expect(() =>
      loadEnvironment({
        ...base,
        NODE_ENV: "production",
        WEB_ORIGIN: "https://agat.example",
        OTP_PROVIDER: "mock",
      }),
    ).toThrow(/forbidden/);
  });
  it("requires secure production origin and strong signing secret", () => {
    expect(() =>
      loadEnvironment({ ...base, NODE_ENV: "production", OTP_PROVIDER: "sms" }),
    ).toThrow(/HTTPS/);
    expect(() =>
      loadEnvironment({ ...base, JWT_ACCESS_SECRET: "short" }),
    ).toThrow(/32/);
  });
});
