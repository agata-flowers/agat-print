# Test strategy

- Unit: environment validation, OTP TTL/attempt/reuse, refresh digest/rotation, cookie policy, metric-label allowlist.
- Integration: Prisma constraints, transactional partner approval, session family revocation, audit redaction, bootstrap uniqueness.
- E2E: CSRF acquisition, customer login/profile/logout/refresh; partner application, pending denial, admin approval, partner access.
- Contract: OpenAPI validity, `/api/v1` prefix, error envelope, no-store headers.
- Operations: clean migration, Compose health, consistent PostgreSQL dump, MinIO manifest, isolated restore, RPO/RTO measurement.
- CI: frozen install, format check, lint, typecheck, tests, Prisma validation, build, Compose validation, Docker image builds.

Stage 2 acceptance explicitly excludes uploads, conversion, preflight, orders, payments, matching, printing, and delivery.
