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
  redisUrl: string;
  minioEndpoint: string;
  minioAccessKey: string;
  minioSecretKey: string;
  minioBucket: string;
  clamavHost: string;
  clamavPort: number;
  uploadMaxFileBytes: number;
  uploadMaxPages: number;
  uploadUserActiveQuotaBytes: number;
  uploadMaxImagePixels: number;
  uploadSessionTtlSeconds: number;
  docxMaxEntries: number;
  docxMaxUncompressedBytes: number;
  docxMaxCompressionRatio: number;
  processingDispatchEnabled: boolean;
  processingImage: string;
  processingRunnerScript: string;
  processingSeccompProfile: string;
  processingTimeoutSeconds: number;
  previewSignedUrlTtlSeconds: number;
  paymentProvider: string;
  mockPaymentSecret: string;
  matchingDispatchEnabled: boolean;
  partnerOfferTtlSeconds: number;
  partnerPayoutBasisPoints: number;
  partnerPayoutRuleVersion: string;
}

const integer = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error("Invalid positive integer environment value");
  return parsed;
};

const assertProductionSecret = (secret: string): void => {
  const forbiddenMarker =
    /development|test-only|ci-only|local-only|change-me|replace-outside|example|password|secret-at-least/i;
  if (forbiddenMarker.test(secret) || new Set(secret).size < 10)
    throw new Error("Development JWT secrets are forbidden in production");
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
  const paymentProvider = source.PAYMENT_PROVIDER ?? "mock";
  if (nodeEnv === "production" && paymentProvider === "mock")
    throw new Error("Mock payment is forbidden in production");
  const mockPaymentSecret =
    source.MOCK_PAYMENT_SECRET ?? "development-only-mock-payment-secret";
  const jwtSecret = source.JWT_ACCESS_SECRET ?? "";
  if (jwtSecret.length < 32)
    throw new Error("JWT_ACCESS_SECRET must contain at least 32 characters");
  const webOrigin = source.WEB_ORIGIN ?? "http://localhost:3000";
  const origin = new URL(webOrigin);
  if (nodeEnv === "production" && origin.protocol !== "https:")
    throw new Error("Production WEB_ORIGIN must use HTTPS");
  if (nodeEnv === "production") {
    assertProductionSecret(jwtSecret);
    if (source.MOCK_OTP_CODE)
      throw new Error("MOCK_OTP_CODE is forbidden in production");
    if (source.MOCK_PAYMENT_SECRET)
      throw new Error("MOCK_PAYMENT_SECRET is forbidden in production");
    for (const [name, value] of [
      ["MINIO_ACCESS_KEY", source.MINIO_ACCESS_KEY ?? ""],
      ["MINIO_SECRET_KEY", source.MINIO_SECRET_KEY ?? ""],
    ] as const) {
      if (!value || forbiddenProductionValue(value))
        throw new Error(`${name} must come from the production secret store`);
    }
  }
  const partnerPayoutBasisPoints = integer(
    source.PARTNER_PAYOUT_BASIS_POINTS,
    8000,
  );
  if (partnerPayoutBasisPoints > 10_000)
    throw new Error("PARTNER_PAYOUT_BASIS_POINTS must not exceed 10000");
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
    redisUrl: source.REDIS_URL ?? "redis://localhost:6379",
    minioEndpoint: source.MINIO_ENDPOINT ?? "http://localhost:9000",
    minioAccessKey: source.MINIO_ACCESS_KEY ?? "development-only",
    minioSecretKey: source.MINIO_SECRET_KEY ?? "development-only-change-me",
    minioBucket: source.MINIO_BUCKET ?? "agat-private",
    clamavHost: source.CLAMAV_HOST ?? "localhost",
    clamavPort: integer(source.CLAMAV_PORT, 3310),
    uploadMaxFileBytes: integer(source.UPLOAD_MAX_FILE_BYTES, 26_214_400),
    uploadMaxPages: integer(source.UPLOAD_MAX_PAGES, 100),
    uploadUserActiveQuotaBytes: integer(
      source.UPLOAD_USER_ACTIVE_QUOTA_BYTES,
      262_144_000,
    ),
    uploadMaxImagePixels: integer(source.UPLOAD_MAX_IMAGE_PIXELS, 40_000_000),
    uploadSessionTtlSeconds: integer(source.UPLOAD_SESSION_TTL_SECONDS, 86_400),
    docxMaxEntries: integer(source.DOCX_MAX_ENTRIES, 2_000),
    docxMaxUncompressedBytes: integer(
      source.DOCX_MAX_UNCOMPRESSED_BYTES,
      104_857_600,
    ),
    docxMaxCompressionRatio: integer(source.DOCX_MAX_COMPRESSION_RATIO, 100),
    processingDispatchEnabled:
      (source.PROCESSING_DISPATCH_ENABLED ?? "false") === "true",
    processingImage: source.PROCESSING_IMAGE ?? "agat-processing:local",
    processingRunnerScript:
      source.PROCESSING_RUNNER_SCRIPT ?? "ops/processing/run-job.sh",
    processingSeccompProfile:
      source.PROCESSING_SECCOMP_PROFILE ?? "ops/processing/seccomp.json",
    processingTimeoutSeconds: integer(source.PROCESSING_TIMEOUT_SECONDS, 120),
    previewSignedUrlTtlSeconds: integer(
      source.PREVIEW_SIGNED_URL_TTL_SECONDS,
      300,
    ),
    paymentProvider,
    mockPaymentSecret,
    matchingDispatchEnabled:
      (source.MATCHING_DISPATCH_ENABLED ?? "false") === "true",
    partnerOfferTtlSeconds: integer(source.PARTNER_OFFER_TTL_SECONDS, 180),
    partnerPayoutBasisPoints,
    partnerPayoutRuleVersion: source.PARTNER_PAYOUT_RULE_VERSION ?? "mvp-v1",
  };
}

const forbiddenProductionValue = (value: string): boolean =>
  /development|test-only|ci-only|local-only|change-me|example|password/i.test(
    value,
  ) || value.length < 16;
