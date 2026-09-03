# Operations and recovery

## Deployment services

`web`, `api`, `postgres`, `redis`, `minio`, `clamav`, and the trusted
processing worker run as isolated services. PostgreSQL and MinIO hold durable
state; Redis is disposable. Production terminates TLS at a reverse proxy and
injects secrets outside Compose source.

## Backup scope

- PostgreSQL: consistent custom-format `pg_dump --serializable-deferrable`.
- MinIO: permanent, non-expired objects referenced by the database backup
  manifest, including originals, derivatives, immutable previews and
  print-ready objects.
- Configuration: bucket policies/versioning/lifecycle are source-controlled configuration, not raw volume copies.
- Excluded: Redis, caches, incomplete/temp objects, logs, metrics, processing workspaces, and Docker volumes.

The backup job stages the database dump and a tab-separated allow-list manifest, copies only manifest objects after SHA-256 verification, and sends the set to encrypted restic storage at a distinct S3-compatible endpoint. Object keys and paths are never printed. Production validation rejects a primary-storage endpoint, local/example endpoints, mock credentials, and placeholder secrets. `RESTIC_PASSWORD` is kept outside the VPS and both object stores.

The manifest query includes only `PermanentObjectReference` rows that are not
deleted, have not expired, and have no matching `RetentionTombstone`. Stages 3
and 4 create these references only after validation and a clean antivirus
verdict. Signed URLs are never part of the manifest; it contains only opaque
keys and SHA-256 checksums.

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
- Mock payment and `MOCK_PAYMENT_SECRET` must fail startup; production payment
  credentials live only in the deployment secret store.
- `Secure` cookies and a non-development signing secret are mandatory.
- Backup endpoint must be off-host and credentials supplied by secret storage.
- Alerts cover backup failure, restore verification failure, auth abuse, and health/readiness.

## Protected upload operations

- Pre-create the private MinIO bucket in production. The API must fail rather
  than create infrastructure when the bucket is absent.
- Configure ClamAV on a private network. A timeout, connection error or unknown
  response is a failed upload; never promote during an outage.
- Keep upload limits in deployment configuration. The initial MVP values are
  25 MiB/file, 100 pages, 250 MiB active/user and 40 megapixels/image.
- Run expiry cleanup continuously. Quarantine removal and database status CAS
  are idempotent; investigate any object left without a live database session.
- Never inspect payloads by copying them into tickets or command output.

## Processing worker runbook

The BullMQ worker is a trusted orchestrator and requires access to the Docker
daemon; the untrusted processing child never does. Restrict worker deployment
and daemon access to a dedicated host or rootless Docker context.

1. Build `agat-processing:local` from `ops/processing/Dockerfile`.
2. Keep `ops/processing/seccomp.json` immutable and reviewed.
3. Start the worker with database, Redis, MinIO and ClamAV credentials in its
   secret store. These values are deliberately omitted from the child
   environment.
4. The worker claims a database lease before downloading input. Retries reuse
   the same BullMQ/dedup key. Exhausted retries become `DEAD_LETTER`.
5. `run-job.sh` creates two random per-job volumes, copies one input, launches
   the isolated child, copies one result and removes both volumes via a trap.
6. The API validates and rescans output before creating the unique durable
   result. A completed inbox record makes later deliveries no-ops.

Do not relax `network=none`, read-only root, UID 65532, capability drop,
`no-new-privileges`, seccomp or CPU/RAM/PID/time limits to process a failing
document. Treat repeated failures as a security/compatibility incident.

## Payment operations

The stage-5 provider is synthetic and development/test only. Callbacks are
HMAC-authenticated and recorded by unique provider event ID. Operators must
never paste callback bodies, signatures, idempotency keys, provider references,
money values or customer identifiers into logs or incident tickets. A payment
or refund stuck in a pending state is investigated from bounded domain status
and protected database records; it is never repaired with direct status SQL.
Run `bash ops/verify/stage5.sh` on a Docker host to exercise clean/repeated
migration deployment, provider policy, DB-E2E, telemetry/cache policy and
duplicate-payment/refund integrity.

# Matching operations

- Default offer TTL is 180 seconds and is configured with
  `PARTNER_OFFER_TTL_SECONDS`; a change affects only newly created offers.
- Redis jobs are delivery hints. PostgreSQL outbox/inbox, offer state and order
  version are authoritative. Replaying a job is safe.
- An `EXHAUSTED` matching aggregate permanently blocks later offers and emits a
  single idempotent stage 5 refund intent. Operators must not manually rewrite
  matching, offer, assignment, payout or refund rows.
- Partner production is manual through `READY`. There is no printer agent,
  pickup, courier or completion operation in stage 6.

# Stage 7 printer and delivery operations

- Register a branch-local agent only from the ADMIN endpoint and transfer its
  ID/token once through the deployment secret channel. The database retains
  only a token digest. Revoke or rotate the machine if its host is lost.
- The agent validates PDF signature/size, writes an atomic mode-0600 file into
  its configured OS spool boundary and never logs credentials or URLs. Its
  container drops capabilities, is read-only and gets only a private spool
  mount. Hardware/driver acceptance is outside the central API provider port.
- `FULFILLMENT_DISPATCH_ENABLED` enables the PostgreSQL-outbox/BullMQ consumer.
  Redis loss is recoverable by redispatch; `InboxOperation`, unique jobs and
  aggregate CAS remain authoritative.
- Pickup PIN TTL defaults to 24 hours with five attempts. Rotate
  `PICKUP_PIN_SECRET` only with an explicit migration/expiry plan because live
  PIN verification depends on it. `DELIVERY_DATA_KEY` must be a secret-store
  supplied base64 256-bit key; loss makes active addresses unrecoverable.
- Delivery uses the provider interface. `mock` is rejected in production.
  A missing compatible active courier fails closed to `DELIVERY_FAILED`; direct
  status SQL is prohibited.
- Run `bash ops/verify/stage7.sh` on a Docker host and retain the generated
  `stage7-verification-report.json` artifact without copying synthetic PINs,
  addresses, agent credentials or object references into reports.

## Stage 8 disputes, reprints and retention

AFTERCARE_DISPATCH_ENABLED enables the aftercare queue/worker. It publishes
refund intents and synthetic provider confirmations, sends bounded provider
notifications and schedules a retention sweep every minute. Database job
leases renew every 30 seconds; five failed attempts produce DEAD_LETTER.
Investigate using bounded error codes and the protected database console.
Never repair financial state or immutable resolutions with direct status SQL.

Retention policy v1 is originals 7 days, derivatives/previews/print-ready 30
days after terminal state; active production and legal holds protect objects.
Releasing a hold restarts the applicable object retention period. Unfinished
uploads keep the existing 24-hour cleanup. Technical access-audit policy is
90 days; Stage 8 does not purge order/payment/payout/refund/dispute records or
financial/legal audit records. Deletion attempts stop after five storage errors
and require operator investigation, not tombstone removal.

Backup now exports one serializable snapshot for pg_dump and manifest while
holding deletion exclusion. Active-hold objects remain referenced/nonexpired
and are included. A separate encrypted restic tag, agat-retention-ledger, stores
the deletion ledger. Old data restores require this latest ledger, even when
RESTIC_SNAPSHOT_ID selects an earlier data snapshot. Missing ledger fails
closed. Older pre-Stage-8 backups need a separately available current ledger;
do not silently skip this requirement. RESTIC_LEDGER_SNAPSHOT_ID is only for
controlled forensic recovery and must never be used to bypass later deletions.

Restore into isolated PostgreSQL/MinIO with all API/workers disabled. Merge the
ledger, restore manifest objects, replay all tombstones (including stale target
objects), verify SHA-256 and holds, then inspect retained financial/legal
records and reset/reconcile expired job leases through normal workers.
Only then enable API traffic. Snapshot/ledger backup RPO remains <=24 hours;
post-backup deletions still require a current ledger within that RPO. Run a
monthly isolated drill and record measured RPO/RTO, not target values as facts.
The same-host backup-minio in compose.verify.yaml is only a test stand-in;
production requires an independently managed off-host endpoint and encryption
secret held separately.
