export interface AppEnvironment {
  nodeEnv: "development" | "test" | "production";
  webOrigin: string;
  port: number;
  jwtSecret: string;
  otpProvider: string;
  mockOtpCode: string;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpRateLimitPerHour: number;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

const integer = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error("Invalid positive integer environment value");
  return parsed;
};

export function loadEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): AppEnvironment {
  const nodeEnv = (source.NODE_ENV ??
    "development") as AppEnvironment["nodeEnv"];
  if (!["development", "test", "production"].includes(nodeEnv))
    throw new Error("Invalid NODE_ENV");
  const otpProvider = source.OTP_PROVIDER ?? "mock";
  if (nodeEnv === "production" && otpProvider === "mock")
    throw new Error("Mock OTP is forbidden in production");
  const jwtSecret = source.JWT_ACCESS_SECRET ?? "";
  if (jwtSecret.length < 32)
    throw new Error("JWT_ACCESS_SECRET must contain at least 32 characters");
  const webOrigin = source.WEB_ORIGIN ?? "http://localhost:3000";
  const origin = new URL(webOrigin);
  if (nodeEnv === "production" && origin.protocol !== "https:")
    throw new Error("Production WEB_ORIGIN must use HTTPS");
  return {
    nodeEnv,
    webOrigin,
    port: integer(source.API_PORT, 4000),
    jwtSecret,
    otpProvider,
    mockOtpCode: source.MOCK_OTP_CODE ?? "000000",
    otpTtlSeconds: integer(source.OTP_TTL_SECONDS, 300),
    otpMaxAttempts: integer(source.OTP_MAX_ATTEMPTS, 5),
    otpRateLimitPerHour: integer(source.OTP_RATE_LIMIT_PER_HOUR, 5),
    accessTtlSeconds: integer(source.ACCESS_TTL_SECONDS, 900),
    refreshTtlSeconds: integer(source.REFRESH_TTL_SECONDS, 2_592_000),
  };
}
