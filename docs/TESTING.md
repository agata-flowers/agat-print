# Test strategy

- Unit: environment validation, OTP TTL/attempt/reuse, refresh digest/rotation, cookie policy, metric-label allowlist.
- Integration: Prisma constraints, transactional partner approval, session family revocation, audit redaction, bootstrap uniqueness.
- E2E: CSRF acquisition, customer login/profile/logout/refresh; partner application, pending denial, admin approval, partner access.
- Contract: OpenAPI validity, `/api/v1` prefix, error envelope, no-store headers.
- Operations: clean and repeated migrations, Compose health, consistent PostgreSQL dump, manifest allow-list, source deletion, isolated PostgreSQL/MinIO restore, mandatory tombstone replay, checksum verification, and RPO/RTO measurement.
- CI quality job: fresh checkout, frozen install, format check, lint, typecheck, unit/DB-E2E tests, Prisma validation, production build, Compose validation, and API/web image builds.
- CI infrastructure job: standard Git index and clean status, all Compose image builds, clean/repeated migration deploy, production configuration rejection tests, service health/readiness, synthetic encrypted off-host backup, isolated restore, integrity checks, and a downloadable RPO/RTO report.

## Stage 3 acceptance

- Unit: format/media/signature matching, PDF pages, decoded image pixels, DOCX
  entry/unpacked/ratio/traversal controls, stable dedup keys and fail-closed AV.
- E2E: PDF, DOCX, JPG, JPEG and PNG success; forbidden formats and every MVP
  limit; EICAR; quotas; cancellation and expiry cleanup; outbox dispatch and
  duplicate result delivery.
- Container: no network or infrastructure secret names, read-only root,
  non-root user, dropped capabilities, `no-new-privileges`, explicit seccomp,
  CPU/RAM/PID ceilings, enforced timeout, one read-only input and separate
  output volume, and no leftover per-job volumes.
- Telemetry: known synthetic markers, opaque storage prefixes, filenames and
  signed URLs are absent from API logs, audit metadata and metric labels.

Stage 3 explicitly excludes user preview, full preflight, manual review, layout
approval, orders, prices, payments, partner selection, production and delivery.

## Stage 4 acceptance

- Runtime: successful real PDF, DOCX/LibreOffice, JPEG and PNG preflight;
  corrupted/encrypted PDF and invalid DOCX conversion fail closed; output JSON
  includes bounded pages, page geometry, orientation and print suitability.
- Persistence: preview and print-ready rows contain SHA-256, source/settings
  provenance and unique immutable versions; identical input is idempotent and
  changed settings append a version and revoke the active approval pointer.
- State/RBAC: low resolution reaches `QUALITY_CHECK_FAILED`; uncertain document
  photos reach `MANUAL_REVIEW_REQUIRED`; only admins can list/decide reviews;
  customers can read/confirm only their own latest preview.
- Concurrency: two confirmation attempts create exactly one approval; stale
  versions return conflict.
- Privacy/cache: API views and audit/metric/log output contain no filenames,
  object keys, signed URLs or personal values; layout/document routes are
  network-only and `no-store, private`.

Stage 4 explicitly excludes orders, prices, snapshots, payments, refunds,
partner selection, production, printing and delivery.
