# Operations and recovery

## Deployment services

`web`, `api`, `postgres`, `redis`, and `minio` run as isolated containers. PostgreSQL and MinIO hold durable state; Redis is disposable. Production terminates TLS at a reverse proxy and injects secrets outside Compose source.

## Backup scope

- PostgreSQL: consistent custom-format `pg_dump --serializable-deferrable`.
- MinIO: permanent, non-expired objects referenced by the database backup manifest, including originals, approved previews, and print-ready objects once those tables exist.
- Configuration: bucket policies/versioning/lifecycle are source-controlled configuration, not raw volume copies.
- Excluded: Redis, caches, incomplete/temp objects, logs, metrics, processing workspaces, and Docker volumes.

The backup job stages the database dump and a tab-separated allow-list manifest, copies only manifest objects after SHA-256 verification, and sends the set to encrypted restic storage at a distinct S3-compatible endpoint. Object keys and paths are never printed. Production validation rejects a primary-storage endpoint, local/example endpoints, mock credentials, and placeholder secrets. `RESTIC_PASSWORD` is kept outside the VPS and both object stores.

The manifest query includes only `PermanentObjectReference` rows that are not deleted, have not expired, and have no matching `RetentionTombstone`. The current stage 2 schema exists solely to make this policy executable; it does not expose upload or document-processing behavior.

Required backup variables are `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `BACKUP_S3_URL`, `BACKUP_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `MINIO_ALIAS_URL`, `MINIO_BUCKET`, `MINIO_ACCESS_KEY`, and `MINIO_SECRET_KEY`. Run the backup container from a scheduler with injected secrets:

```sh
docker compose --profile backup run --rm backup
```

## Restore order

1. Isolate the restore environment and keep API unavailable.
2. Restore PostgreSQL with `pg_restore`.
3. Restore manifest-listed MinIO objects and repository-managed bucket configuration.
4. Replay every `RetentionTombstone`, including deletion of stale objects that predate the selected snapshot. A missing tombstone table fails the restore.
5. Re-run `prisma migrate deploy`, validate database references and object checksums, and check readiness.
6. Enable API only after the integrity checks and tombstone replay succeed.

Run an isolated restore against empty PostgreSQL and MinIO targets; never point the restore command at production services:

```sh
docker compose -f compose.yaml -f compose.verify.yaml --profile backup run --rm restore
```

`ops/verify/stage2.sh` automates the drill on a disposable Docker host. It creates retained and tombstoned synthetic objects, backs them up, deletes source data, restores into isolated services, proves checksum equality, proves stale-object deletion, reapplies migrations, and writes measured RPO/RTO to `outputs/stage2-verification-report.json`.

Target RPO is 24 hours and RTO is 4 hours. Run a monthly isolated restore drill and retain its timestamp, snapshot ID, data age, duration, validation result, and operator—never customer data.

For the drill, measured RPO is the age of the selected backup when recovery starts; measured RTO is elapsed time from restore start through database, object, tombstone, migration, and integrity validation. The CI drill is synthetic evidence of recoverability, not a substitute for the monthly off-host production drill.

## Production readiness

- Mock OTP must fail startup.
- `Secure` cookies and a non-development signing secret are mandatory.
- Backup endpoint must be off-host and credentials supplied by secret storage.
- Alerts cover backup failure, restore verification failure, auth abuse, and health/readiness.
