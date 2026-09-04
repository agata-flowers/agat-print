#!/usr/bin/env bash
set -euo pipefail
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"
: "${BACKUP_S3_URL:?BACKUP_S3_URL is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
: "${MINIO_ALIAS_URL:?MINIO_ALIAS_URL is required}"
: "${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY is required}"
: "${MINIO_SECRET_KEY:?MINIO_SECRET_KEY is required}"
: "${MINIO_BUCKET:?MINIO_BUCKET is required}"
if [[ "$BACKUP_S3_URL" == "$MINIO_ALIAS_URL" ]]; then
  echo 'Backup endpoint must differ from primary object storage' >&2; exit 2
fi
if [[ "${NODE_ENV:-development}" == production && "$BACKUP_S3_URL" =~ (localhost|127\.0\.0\.1|^http://minio:9000|example\.invalid) ]]; then
  echo 'Production backup endpoint must be off-host' >&2; exit 2
fi
if [[ "${NODE_ENV:-development}" == production && "${RESTIC_PASSWORD}${AWS_SECRET_ACCESS_KEY:-}${MINIO_SECRET_KEY}" =~ (development-only|replace-outside|change-me) ]]; then
  echo 'Development backup credentials are forbidden in production' >&2; exit 2
fi
work_dir="$(mktemp -d)"
snapshot_pid=""
cleanup() {
  local result="$?"
  if [[ -n "$snapshot_pid" ]]; then kill "$snapshot_pid" 2>/dev/null || true; fi
  rm -rf "$work_dir"
  return "$result"
}
trap cleanup EXIT
date -u +%FT%TZ > "$work_dir/backup-created-at.txt"
# Hold deletion exclusion before acquiring the serializable snapshot.
coproc db_snapshot { psql -XAtq -v ON_ERROR_STOP=1; }
snapshot_pid="$db_snapshot_PID"
snapshot_input="${db_snapshot[1]}"
printf '%s\n' 'SELECT pg_advisory_lock(815008);' 'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE;' "SELECT 'SNAPSHOT:' || pg_export_snapshot();" >&"$snapshot_input"
snapshot=""
while IFS= read -r line <&"${db_snapshot[0]}"; do
  if [[ "$line" == SNAPSHOT:* ]]; then snapshot="${line#SNAPSHOT:}"; break; fi
done
[[ "$snapshot" =~ ^[0-9A-Fa-f-]+$ ]] || { echo 'Snapshot export failed' >&2; exit 3; }
pg_dump --format=custom --snapshot="$snapshot" --file="$work_dir/postgres.dump"
printf 'object_key\tchecksum\n' > "$work_dir/minio-manifest.tsv"
psql -XAtqF $'\t' -v ON_ERROR_STOP=1 <<SQL >> "$work_dir/minio-manifest.tsv"
BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY;
SET TRANSACTION SNAPSHOT '$snapshot';
select r."objectKey", r."checksum" from "PermanentObjectReference" r where r."deletedAt" is null and r."expiresAt" > now() and not exists (select 1 from "RetentionTombstone" t where t."objectKey" = r."objectKey") order by r."objectKey";
COMMIT;
SQL
mc alias set source "$MINIO_ALIAS_URL" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
mc alias set offsite "$BACKUP_S3_URL" "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" >/dev/null
mc mb --ignore-existing "offsite/${BACKUP_S3_BUCKET}" >/dev/null
mkdir -p "$work_dir/minio"
tail -n +2 "$work_dir/minio-manifest.tsv" | while IFS=$'\t' read -r object_key checksum; do
  [[ -z "$object_key" ]] && continue
  [[ "$object_key" =~ ^[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+$ && "$object_key" != */.. ]] || { echo 'Unsafe manifest key' >&2; exit 3; }
  mkdir -p "$(dirname "$work_dir/minio/${object_key}")"
  mc cp "source/${MINIO_BUCKET}/${object_key}" "$work_dir/minio/${object_key}" >/dev/null 2>&1 || {
    echo 'Object backup copy failed' >&2; exit 3;
  }
  actual_checksum="$(sha256sum "$work_dir/minio/${object_key}" | cut -d' ' -f1)"
  [[ "$actual_checksum" == "$checksum" ]] || { echo 'Object checksum mismatch' >&2; exit 3; }
done
printf '%s\n' 'COMMIT;' '\q' >&"$snapshot_input"
wait "$snapshot_pid"
snapshot_pid=""
# The latest encrypted ledger must be replayed even with an older data snapshot.
mkdir -p "$work_dir/ledger"
psql -XAtq -v ON_ERROR_STOP=1 -c 'COPY (SELECT "objectKey", reason, "deletedAt" FROM "RetentionTombstone" ORDER BY "objectKey") TO STDOUT WITH (FORMAT csv, HEADER true)' > "$work_dir/ledger/retention-tombstones.csv"
restic snapshots >/dev/null 2>&1 || restic init
restic backup --quiet --tag agat-retention-ledger "$work_dir/ledger"
restic backup --quiet --tag agat-print-stage2 "$work_dir"
restic forget --quiet --group-by host,tags --keep-within "${BACKUP_RETENTION_DAYS:-30}d" --prune
echo 'Encrypted off-host backup completed.'
