# Operations and recovery

## Deployment services

`web`, `api`, `postgres`, `redis`, and `minio` run as isolated containers. PostgreSQL and MinIO hold durable state; Redis is disposable. Production terminates TLS at a reverse proxy and injects secrets outside Compose source.

## Backup scope

- PostgreSQL: consistent custom-format `pg_dump --serializable-deferrable`.
- MinIO: permanent, non-expired objects referenced by the database backup manifest, including originals, approved previews, and print-ready objects once those tables exist.
- Configuration: bucket policies/versioning/lifecycle are source-controlled configuration, not raw volume copies.
- Excluded: Redis, caches, incomplete/temp objects, logs, metrics, processing workspaces, and Docker volumes.

The backup job stages the database dump and object manifest, copies only manifest objects, and sends the set to encrypted restic storage at an off-host S3-compatible endpoint. Production validation rejects localhost/private backup endpoints and placeholder secrets.

## Restore order

1. Isolate the restore environment and keep API unavailable.
2. Restore PostgreSQL with `pg_restore`.
3. Restore manifest-listed MinIO objects and bucket configuration.
4. Apply retention/deletion tombstones.
5. Validate database references, object checksums, migrations, and health.
6. Enable API only after sign-off.

Target RPO is 24 hours and RTO is 4 hours. Run a monthly isolated restore drill and retain its timestamp, snapshot ID, data age, duration, validation result, and operator—never customer data.

## Production readiness

- Mock OTP must fail startup.
- `Secure` cookies and a non-development signing secret are mandatory.
- Backup endpoint must be off-host and credentials supplied by secret storage.
- Alerts cover backup failure, restore verification failure, auth abuse, and health/readiness.
