# AGAT PRINT

Foundation for the AGAT PRINT mobile-first printing platform. This repository currently implements stages 1–2 only: planning documentation, identity, partner onboarding, admin approval, safe sessions, observability, and deployment foundations. File handling is intentionally absent.

## Prerequisites

- Node.js 24+
- pnpm 11+
- Docker with Compose (for PostgreSQL, Redis, MinIO and backup verification)

## Local start

1. Copy `.env.example` to `.env` and replace development secrets.
2. Run `docker compose up -d postgres redis minio`.
3. Run `pnpm install --frozen-lockfile`.
4. Run `pnpm db:generate && pnpm db:migrate`.
5. Run `pnpm dev`.

Web: `http://localhost:3000`; API: `http://localhost:4000/api/v1`; OpenAPI: `http://localhost:4000/api/docs`.

Development mock OTP is the value of `MOCK_OTP_CODE`. It is returned only when `NODE_ENV=development` and cannot start in production.

## Bootstrap administrator

Run `pnpm admin:bootstrap` in an interactive production shell. Enter the administrator phone through stdin. The command refuses to run when an administrator already exists and never echoes the phone in application logs. Login still requires a configured non-mock OTP provider in production.

## Quality gates

`pnpm run ci` runs formatting, lint, types, tests, Prisma validation, and production builds. GitHub Actions performs a frozen install from a fresh checkout with the standard Git index, then builds all Docker images and runs the isolated stage 2 infrastructure drill.

## Backup and restore

Set an off-host `RESTIC_REPOSITORY`, `BACKUP_S3_URL`, `BACKUP_S3_BUCKET`, S3 credentials, and `RESTIC_PASSWORD`, then run `docker compose --profile backup run --rm backup` as described in [operations](docs/OPERATIONS.md). PostgreSQL uses a consistent custom-format `pg_dump`; only permanent, non-expired MinIO objects referenced by the database manifest are in scope. Redis, caches, logs, metrics, and temporary objects are excluded.

On an isolated Docker host, run the complete recovery check with `bash ops/verify/stage2.sh`. The script uses disposable Compose volumes, restores into separate PostgreSQL and MinIO services, applies deletion tombstones before validation, and records actual RPO/RTO under the ignored `outputs/` directory.

Recovery targets for the pilot are RPO ≤ 24 hours and RTO ≤ 4 hours. A monthly isolated restore drill is mandatory.

## Scope boundary

Do not begin stage 3. Supported future upload formats are limited to PDF, DOCX, JPG/JPEG, and PNG, but this repository does not yet accept files.
