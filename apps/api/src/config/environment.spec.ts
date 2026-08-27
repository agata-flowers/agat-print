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
      loadEnvironment({
        ...base,
        NODE_ENV: "production",
        OTP_PROVIDER: "sms",
        JWT_ACCESS_SECRET: "q7Ve4!Tn9#Lm2@Rx8$Bp5%Kd1&Hs6*Wz",
      }),
    ).toThrow(/HTTPS/);
    expect(() =>
      loadEnvironment({ ...base, JWT_ACCESS_SECRET: "short" }),
    ).toThrow(/32/);
  });
  it("rejects known development secrets in production", () => {
    expect(() =>
      loadEnvironment({
        ...base,
        NODE_ENV: "production",
        WEB_ORIGIN: "https://agat.example",
        OTP_PROVIDER: "sms",
        JWT_ACCESS_SECRET: "development-only-change-me-at-least-32-chars",
      }),
    ).toThrow(/Development JWT secrets/);
    expect(() =>
      loadEnvironment({
        ...base,
        NODE_ENV: "production",
        WEB_ORIGIN: "https://agat.example",
        OTP_PROVIDER: "sms",
        JWT_ACCESS_SECRET: "x".repeat(64),
      }),
    ).toThrow(/Development JWT secrets/);
  });
  it("rejects mock-only configuration in production", () => {
    expect(() =>
      loadEnvironment({
        NODE_ENV: "production",
        WEB_ORIGIN: "https://agat.example",
        OTP_PROVIDER: "sms",
        JWT_ACCESS_SECRET: "q7Ve4!Tn9#Lm2@Rx8$Bp5%Kd1&Hs6*Wz",
        MOCK_OTP_CODE: "000000",
      }),
    ).toThrow(/MOCK_OTP_CODE/);
  });
});
