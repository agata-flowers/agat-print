# AGAT PRINT

Foundation for the AGAT PRINT mobile-first printing platform. This repository
implements stages 1–6: planning, platform foundation, protected upload,
isolated processing, preflight, immutable layout artifacts, manual review and
customer layout approval, versioned pricing, mock payment/refund and partner
matching through manual production readiness.

## Prerequisites

- Node.js 24+
- pnpm 11+
- Docker with Compose (for PostgreSQL, Redis, MinIO, ClamAV, processing and backup verification)

## Local start

1. Copy `.env.example` to `.env` and replace development secrets.
2. Run `docker compose up -d postgres redis minio clamav`.
3. Run `pnpm install --frozen-lockfile`.
4. Run `pnpm db:generate && pnpm db:migrate`.
5. Run `pnpm dev`.

Web: `http://localhost:3000`; API: `http://localhost:4000/api/v1`; OpenAPI: `http://localhost:4000/api/docs`.

Development mock OTP is the value of `MOCK_OTP_CODE`. It is returned only when `NODE_ENV=development` and cannot start in production.
The mock payment provider is selected with `PAYMENT_PROVIDER=mock`; it and
`MOCK_PAYMENT_SECRET` are also rejected in production.

## Bootstrap administrator

Run `pnpm admin:bootstrap` in an interactive production shell. Enter the administrator phone through stdin. The command refuses to run when an administrator already exists and never echoes the phone in application logs. Login still requires a configured non-mock OTP provider in production.

## Quality gates

`pnpm run ci` runs formatting, lint, types, tests, Prisma validation, and
production builds. GitHub Actions performs a frozen install from a fresh
checkout with the standard Git index, runs the stage 2 recovery drill, then
runs the stage 3 upload/processing isolation drill, the stage 4
preflight/approval drill, the stage 5 commerce drill and the stage 6 matching
drill. Diagnostic JSON
artifacts are uploaded even when a drill fails.

## Protected uploads and processing

Stage 3 accepts only PDF, DOCX, JPG/JPEG and PNG. It stores bytes in private
quarantine, validates declared type/signature/structure, requires a clean
ClamAV verdict, then creates an atomic processing request.

Initial configurable limits:

- `UPLOAD_MAX_FILE_BYTES=26214400`
- `UPLOAD_MAX_PAGES=100`
- `UPLOAD_USER_ACTIVE_QUOTA_BYTES=262144000`
- `UPLOAD_MAX_IMAGE_PIXELS=40000000`

Build the isolated runtime and trusted queue worker with:

```sh
docker compose --profile processing build processing-runtime processing-worker
docker compose --profile processing up -d
```

The worker needs a controlled Docker daemon connection. Processing children
receive neither this connection nor infrastructure credentials and have no
network. Run `bash ops/verify/stage3.sh` for the full isolation/E2E check.

## Preflight and layout approval

Only stage 3 files in `READY` state can enter preflight. Create a layout with
`POST /api/v1/layouts`, then poll `GET /api/v1/layouts/{id}`. The isolated
runtime converts DOCX with LibreOffice, validates the resulting PDF and records
page geometry, orientation and image resolution. The API stores immutable,
versioned preview and print-ready PDFs in private MinIO; the browser receives
only a short-lived URL with a no-store response policy.

Low-confidence document photos enter `MANUAL_REVIEW_REQUIRED`. An
administrator handles them under `/admin/reviews`; customers cannot access the
queue. A customer may confirm only the latest `AWAITING_APPROVAL` preview.
Changing source version or layout settings clears the current approval and
creates a new immutable artifact version. Run `bash ops/verify/stage4.sh` for
the complete stage 4 acceptance drill.

## Pricing, orders and mock payment

An admin publishes integer UZS tariff versions under `/admin/tariffs`. A
customer creates an order only from the latest current `LayoutApproval`; the
calculation is copied once into immutable `PriceSnapshot` fields and is not
affected by later tariffs. Order creation and payment/refund commands require
`Idempotency-Key`; same-key changed requests conflict.

The development UI shows the frozen total and drives the signed mock callback.
The internal ADMIN-only synthetic no-executor command requests one full refund;
the order stays `REFUND_PENDING` until provider confirmation. No card data is
accepted. Run `bash ops/verify/stage5.sh` for the Docker/DB acceptance drill.

## Backup and restore

Set an off-host `RESTIC_REPOSITORY`, `BACKUP_S3_URL`, `BACKUP_S3_BUCKET`, S3 credentials, and `RESTIC_PASSWORD`, then run `docker compose --profile backup run --rm backup` as described in [operations](docs/OPERATIONS.md). PostgreSQL uses a consistent custom-format `pg_dump`; only permanent, non-expired MinIO objects referenced by the database manifest are in scope. Redis, caches, logs, metrics, and temporary objects are excluded.

On an isolated Docker host, run the complete recovery check with `bash ops/verify/stage2.sh`. The script uses disposable Compose volumes, restores into separate PostgreSQL and MinIO services, applies deletion tombstones before validation, and records actual RPO/RTO under the ignored `outputs/` directory.

Recovery targets for the pilot are RPO ≤ 24 hours and RTO ≤ 4 hours. A monthly isolated restore drill is mandatory.

## Partner matching and manual production

A successful payment is delivered through the transactional outbox and BullMQ
to the matching module. Only approved partners, active branches and the latest
active capability version are eligible. Candidates are ordered by bounded
priority, deterministic mock-map distance and branch UUID. Each sequential
offer expires after `PARTNER_OFFER_TTL_SECONDS` (180 seconds by default) and
owns an immutable UZS `PartnerPayoutSnapshot`.

Partners use `/partner` to accept or reject their own offer, download the
assigned private print-ready artifact, and manually move the order from
`PARTNER_ACCEPTED` to `IN_PRODUCTION` and `READY`. Exhaustion emits one durable
refund request consumed through the stage 5 idempotent refund command. Run
`bash ops/verify/stage6.sh` for the Docker/Redis/DB acceptance drill.

## Scope boundary

Do not begin stage 7. Direct printer integration, local print agents, pickup
PINs, `AWAITING_PICKUP`, couriers, delivery and `COMPLETED` remain intentionally
absent.
