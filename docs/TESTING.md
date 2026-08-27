# Test strategy

- Unit: environment validation, OTP TTL/attempt/reuse, refresh digest/rotation, cookie policy, metric-label allowlist.
- Integration: Prisma constraints, transactional partner approval, session family revocation, audit redaction, bootstrap uniqueness.
- E2E: CSRF acquisition, customer login/profile/logout/refresh; partner application, pending denial, admin approval, partner access.
- Contract: OpenAPI validity, `/api/v1` prefix, error envelope, no-store headers.
- Operations: clean and repeated migrations, Compose health, consistent PostgreSQL dump, manifest allow-list, source deletion, isolated PostgreSQL/MinIO restore, mandatory tombstone replay, checksum verification, and RPO/RTO measurement.
- CI quality job: fresh checkout, frozen install, format check, lint, typecheck, unit/DB-E2E tests, Prisma validation, production build, Compose validation, and API/web image builds.
- CI infrastructure job: standard Git index and clean status, all Compose image builds, clean/repeated migration deploy, production configuration rejection tests, service health/readiness, synthetic encrypted off-host backup, isolated restore, integrity checks, and a downloadable RPO/RTO report.

Stage 2 acceptance explicitly excludes uploads, conversion, preflight, orders, payments, matching, printing, and delivery.
