# AGAT PRINT

Foundation for the AGAT PRINT mobile-first printing platform. This repository
implements stages 1–3: planning, identity, partner onboarding, protected upload,
safe sessions, observability, recovery and isolated file-processing foundations.

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

## Bootstrap administrator

Run `pnpm admin:bootstrap` in an interactive production shell. Enter the administrator phone through stdin. The command refuses to run when an administrator already exists and never echoes the phone in application logs. Login still requires a configured non-mock OTP provider in production.

## Quality gates

`pnpm run ci` runs formatting, lint, types, tests, Prisma validation, and
production builds. GitHub Actions performs a frozen install from a fresh
checkout with the standard Git index, runs the stage 2 recovery drill, then
runs the stage 3 upload/processing isolation drill.

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

## Backup and restore

Set an off-host `RESTIC_REPOSITORY`, `BACKUP_S3_URL`, `BACKUP_S3_BUCKET`, S3 credentials, and `RESTIC_PASSWORD`, then run `docker compose --profile backup run --rm backup` as described in [operations](docs/OPERATIONS.md). PostgreSQL uses a consistent custom-format `pg_dump`; only permanent, non-expired MinIO objects referenced by the database manifest are in scope. Redis, caches, logs, metrics, and temporary objects are excluded.

On an isolated Docker host, run the complete recovery check with `bash ops/verify/stage2.sh`. The script uses disposable Compose volumes, restores into separate PostgreSQL and MinIO services, applies deletion tombstones before validation, and records actual RPO/RTO under the ignored `outputs/` directory.

Recovery targets for the pilot are RPO ≤ 24 hours and RTO ≤ 4 hours. A monthly isolated restore drill is mandatory.

## Scope boundary

Do not begin stage 4. User preview, full preflight, manual review, layout
approval, orders, pricing, payments, partner matching, production and delivery
remain intentionally absent.
