process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??=
  "postgresql://test-only:test-only@localhost:5432/test_only?schema=public";
process.env.WEB_ORIGIN ??= "http://localhost:3000";
process.env.JWT_ACCESS_SECRET ??= "test-only-secret-at-least-32-characters";
process.env.OTP_PROVIDER ??= "mock";
process.env.MOCK_OTP_CODE ??= "000000";
