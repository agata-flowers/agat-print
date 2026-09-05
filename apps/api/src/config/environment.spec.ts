import { describe, expect, it } from "vitest";
import { loadEnvironment } from "./environment";

const base = {
  JWT_ACCESS_SECRET: "x".repeat(32),
  WEB_ORIGIN: "http://localhost:3000",
  PAYMENT_PROVIDER: "acquiring",
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
  it("rejects mock payment and its secret in production", () => {
    expect(() =>
      loadEnvironment({
        ...base,
        NODE_ENV: "production",
        WEB_ORIGIN: "https://agat.example",
        OTP_PROVIDER: "sms",
        PAYMENT_PROVIDER: "mock",
      }),
    ).toThrow(/Mock payment/);
    expect(() =>
      loadEnvironment({
        ...base,
        NODE_ENV: "production",
        WEB_ORIGIN: "https://agat.example",
        OTP_PROVIDER: "sms",
        PAYMENT_PROVIDER: "acquiring",
        JWT_ACCESS_SECRET: "q7Ve4!Tn9#Lm2@Rx8$Bp5%Kd1&Hs6*Wz",
        MOCK_PAYMENT_SECRET: "not-for-production",
      }),
    ).toThrow(/MOCK_PAYMENT_SECRET/);
  });
  it("requires secure production origin and strong signing secret", () => {
    expect(() =>
      loadEnvironment({
        ...base,
        NODE_ENV: "production",
        OTP_PROVIDER: "sms",
        PAYMENT_PROVIDER: "acquiring",
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
        PAYMENT_PROVIDER: "acquiring",
        JWT_ACCESS_SECRET: "q7Ve4!Tn9#Lm2@Rx8$Bp5%Kd1&Hs6*Wz",
        MOCK_OTP_CODE: "000000",
      }),
    ).toThrow(/MOCK_OTP_CODE/);
  });
  it("requires object-storage credentials from the production secret store", () => {
    expect(() =>
      loadEnvironment({
        NODE_ENV: "production",
        WEB_ORIGIN: "https://print.invalid",
        OTP_PROVIDER: "sms",
        PAYMENT_PROVIDER: "acquiring",
        JWT_ACCESS_SECRET: "q7Ve4!Tn9#Lm2@Rx8$Bp5%Kd1&Hs6*Wz",
        MINIO_ACCESS_KEY: "development-only",
        MINIO_SECRET_KEY: "development-only-change-me",
      }),
    ).toThrow(/secret store/);
  });
  it("rejects mock delivery and stage-7 development secrets in production", () => {
    const production = {
      NODE_ENV: "production",
      WEB_ORIGIN: "https://print.invalid",
      OTP_PROVIDER: "sms",
      PAYMENT_PROVIDER: "acquiring",
      JWT_ACCESS_SECRET: "q7Ve4!Tn9#Lm2@Rx8$Bp5%Kd1&Hs6*Wz",
      MINIO_ACCESS_KEY: "prod-access-9A7b6C5d",
      MINIO_SECRET_KEY: "prod-minio-9A7b6C5d4E3f2G1h",
      PICKUP_PIN_SECRET: "9A7b6C5d4E3f2G1h8J7k6L5m4N3p2Q1r",
      DELIVERY_DATA_KEY: Buffer.from(
        "0123456789abcdef0123456789abcdef",
      ).toString("base64"),
      PRINTER_AGENT_TOKEN_PEPPER: "8J7k6L5m4N3p2Q1r9A7b6C5d4E3f2G1h",
    };
    expect(() =>
      loadEnvironment({ ...production, DELIVERY_PROVIDER: "mock" }),
    ).toThrow(/Mock delivery/);
    expect(() =>
      loadEnvironment({
        ...production,
        DELIVERY_PROVIDER: "dispatch",
        PICKUP_PIN_SECRET: "development-only-pickup-pin-secret",
      }),
    ).toThrow(/PICKUP_PIN_SECRET/);
  });

  it("fails closed until every production finance provider is configured", () => {
    const production = {
      NODE_ENV: "production",
      WEB_ORIGIN: "https://print.invalid",
      JWT_ACCESS_SECRET: "q7Ve4!Tn9#Lm2@Rx8$Bp5%Kd1&Hs6*Wz",
      MINIO_ACCESS_KEY: "prod-access-9A7b6C5d",
      MINIO_SECRET_KEY: "prod-minio-9A7b6C5d4E3f2G1h",
      PICKUP_PIN_SECRET: "9A7b6C5d4E3f2G1h8J7k6L5m4N3p2Q1r",
      DELIVERY_DATA_KEY: Buffer.from(
        "0123456789abcdef0123456789abcdef",
      ).toString("base64"),
      PRINTER_AGENT_TOKEN_PEPPER: "8J7k6L5m4N3p2Q1r9A7b6C5d4E3f2G1h",
      DELIVERY_PROVIDER: "dispatch",
      OTP_PROVIDER: "http",
      PAYMENT_PROVIDER: "http",
      FISCAL_PROVIDER: "http",
      PAYOUT_PROVIDER: "http",
      OTP_PROVIDER_ENDPOINT: "https://otp.invalid/v1/",
      PAYMENT_PROVIDER_ENDPOINT: "https://payments.invalid/v1/",
      FISCAL_PROVIDER_ENDPOINT: "https://fiscal.invalid/v1/",
      PAYOUT_PROVIDER_ENDPOINT: "https://payout.invalid/v1/",
      OTP_PROVIDER_API_KEY: "otp-prod-9A7b6C5d4E3f",
      PAYMENT_PROVIDER_API_KEY: "pay-prod-9A7b6C5d4E3f",
      FISCAL_PROVIDER_API_KEY: "fiscal-prod-9A7b6C5d4E3f",
      PAYOUT_PROVIDER_API_KEY: "payout-prod-9A7b6C5d4E3f",
      PAYMENT_WEBHOOK_SECRET: "webhook-prod-9A7b6C5d4E3f",
      FINANCE_DISPATCH_ENABLED: "true",
    };
    expect(loadEnvironment(production).paymentProvider).toBe("http");
    expect(() =>
      loadEnvironment({ ...production, FISCAL_PROVIDER_API_KEY: "" }),
    ).toThrow(/FISCAL_PROVIDER_API_KEY/);
    expect(() =>
      loadEnvironment({
        ...production,
        PAYMENT_PROVIDER_ENDPOINT: "http://payments.invalid/",
      }),
    ).toThrow(/HTTPS/);
    expect(() =>
      loadEnvironment({ ...production, FINANCE_DISPATCH_ENABLED: "false" }),
    ).toThrow(/FINANCE_DISPATCH_ENABLED/);
  });
});
