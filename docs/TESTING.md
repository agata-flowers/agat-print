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

## Stage 5 acceptance

- Eligibility/RBAC: only the owner’s latest active approval and matching
  print-ready version create an order; only admins publish tariff versions or
  trigger the synthetic no-executor command; foreign orders are hidden.
- Pricing: UZS uses integer minor units; line items and inputs are copied into
  one immutable `PriceSnapshot`; a later tariff leaves it unchanged.
- Idempotency: matching keys replay, changed payload conflicts, repeated
  payment/refund delivery creates no duplicate rows or outbox transitions.
- Provider: success, failure and retry paths; signed callback, replay and wrong
  ordering; `REFUND_PENDING` changes to `REFUNDED` only after confirmation.
- Security: mock payment and development secrets fail in production; no
  financial/personal/provider values occur in logs, safe audit or metric
  labels; commerce routes are no-store and network-only in the PWA.
- Infrastructure: clean and repeated migrations, Compose build/health and
  stage-5 DB-E2E produce `stage5-verification-report.json` even on failure.

Stage 5 explicitly excludes partner matching, `PARTNER_OFFERED`,
`PartnerPayoutSnapshot`, production, printing, pickup, courier and delivery.

# Stage 6 gate

`bash ops/verify/stage6.sh` verifies matching filters/order, TTL/retry, payout
immutability, assignment race/ownership, manual production and exhaustion
refund DB-E2E over PostgreSQL, Redis/BullMQ and private MinIO.

# Stage 7 gate

`bash ops/verify/stage7.sh` builds the API, PWA and branch printer-agent, applies
clean/repeated migrations and runs DB-E2E for machine authentication, job
lease/redelivery, manual/agent race exclusion, derived pickup/handoff PINs,
attempt/expiry/one-time semantics, encrypted address storage, courier approval
and deterministic isolation, `DELIVERY_FAILED`, final `COMPLETED`, immutable
financial snapshots and customer payout isolation. It also checks Redis/BullMQ,
no-store headers and absence of PINs, addresses, tokens, object identifiers,
signed URLs or high-cardinality values in telemetry.

## Stage 8 accepted regression gate

Run pnpm install --frozen-lockfile, pnpm db:generate and pnpm run ci. Note that
pnpm ci is the package-manager clean-install alias, not the repository gate.
The Stage 8 DB scenarios reuse the Stage 7 synthetic fixture suite:
RUN_STAGE8_E2E=1 enables both original Stage 7 cases and the aftercare cases.
Run them against a clean database; do not disable immutable triggers to reuse
old fixture data.

bash ops/verify/stage8.sh applies migrations twice, builds/runs infrastructure,
executes disputes/reprint/refund/retention DB-E2E, checks queue/cache/privacy,
backs up held objects, simulates source-object loss and restores to isolated
PostgreSQL/MinIO. RPO/RTO include the integrity verification. Its JSON report
is initialized before work and written on failure; exit status is preserved.
GitHub Actions uploads stage8-verification-report with if: always(), including
a not_run diagnostic if an earlier regression fails.

Required acceptance additionally includes all Stage 2–7 verification scripts:
OTP/session/RBAC, upload/AV/sandbox, preflight/approval, commerce, matching,
machine-agent/PIN/courier flows. Existing checks are not replaced by the new
suite. Explicitly verify real BullMQ redelivery/crash recovery, concurrent
refund reservations, legal-hold/deletion races and an old snapshot restored
with a newer deletion ledger before claiming Stage 8 acceptance. Tests skipped
because PostgreSQL/Redis/MinIO are absent are not passing DB-E2E.

## Stage 9 gate

`bash ops/verify/stage9.sh` builds the application and operational images,
applies all migrations to a clean PostgreSQL database twice, and runs the Stage
7 fixture with `RUN_STAGE9_E2E=1`. That switch includes Stage 7, Stage 8 and
Stage 9 DB scenarios: production configuration fail-closed behavior, provider
signature/replay/order validation, immutable fiscal receipts, retry, ledger
credit/refund debit, finance RBAC, settlement uniqueness, reconciliation
mismatch persistence and BullMQ redelivery.

The workflow must first run every Stage 2–8 verification script. Stage 9 then
checks PostgreSQL, Redis, MinIO, ClamAV, processing and backup services; privacy
headers/metrics/logs; an encrypted off-host restic backup; isolated restore;
financial row integrity; and measured RPO/RTO. The diagnostic report is created
before execution and uploaded with `if: always()` without changing job failure.

Vendor acceptance is separate: real OTP delivery, acquiring/fiscal sandbox
certification and payout settlement cannot be marked verified until credentials,
merchant contracts, webhook endpoints and provider test environments exist.
