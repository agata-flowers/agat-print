#!/usr/bin/env bash
set -euo pipefail
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"
: "${MINIO_ALIAS_URL:?MINIO_ALIAS_URL is required}"
: "${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY is required}"
: "${MINIO_SECRET_KEY:?MINIO_SECRET_KEY is required}"
: "${MINIO_BUCKET:?MINIO_BUCKET is required}"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
restic restore --quiet "${RESTIC_SNAPSHOT_ID:-latest}" --tag agat-print-stage2 --target "$work_dir/data"
restic restore --quiet "${RESTIC_LEDGER_SNAPSHOT_ID:-latest}" --tag agat-retention-ledger --target "$work_dir/ledger"
ledger="$(find "$work_dir/ledger" -name retention-tombstones.csv -print -quit)"
[[ -n "$ledger" ]] || { echo 'Restore rejected: deletion ledger unavailable' >&2; exit 4; }
dump="$(find "$work_dir" -name postgres.dump -print -quit)"
manifest="$(find "$work_dir" -name minio-manifest.tsv -print -quit)"
test -n "$dump" && test -n "$manifest"
pg_restore --exit-on-error --clean --if-exists --no-owner --dbname="$PGDATABASE" "$dump"
# Merge the most recent deletion ledger, never resurrecting post-snapshot deletions.
psql -Xq -v ON_ERROR_STOP=1 <<SQL
CREATE TEMP TABLE restore_tombstones ("objectKey" varchar(1024), reason varchar(80), "deletedAt" timestamp(3));
\\copy restore_tombstones FROM '$ledger' WITH (FORMAT csv, HEADER true)
INSERT INTO "RetentionTombstone" ("objectKey", reason, "deletedAt")
SELECT "objectKey", reason, "deletedAt" FROM restore_tombstones
ON CONFLICT ("objectKey") DO NOTHING;
UPDATE "PermanentObjectReference" r SET "deletedAt" = t."deletedAt"
FROM "RetentionTombstone" t WHERE t."objectKey" = r."objectKey" AND r."deletedAt" IS NULL;
SQL
mc alias set target "$MINIO_ALIAS_URL" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
mc mb --ignore-existing "target/${MINIO_BUCKET}" >/dev/null
mc ready target >/dev/null
minio_dir="$(dirname "$manifest")/minio"
tail -n +2 "$manifest" | while IFS=$'\t' read -r object_key checksum; do
  [[ -z "$object_key" ]] && continue
  [[ "$object_key" =~ ^[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+$ && "$object_key" != */.. ]] || { echo 'Unsafe object key' >&2; exit 3; }
  actual_checksum="$(sha256sum "$minio_dir/$object_key" | cut -d' ' -f1)"
  [[ "$actual_checksum" == "$checksum" ]] || { echo 'Object checksum mismatch' >&2; exit 3; }
  mc cp "$minio_dir/$object_key" "target/${MINIO_BUCKET}/${object_key}" >/dev/null 2>&1 || {
    echo 'Object restore copy failed' >&2; exit 3;
  }
done
psql -Atqc "select to_regclass('public.\"RetentionTombstone\"') is not null" | grep -qx t || {
  echo 'Restore rejected: retention tombstone table is unavailable' >&2; exit 4;
}
psql -Atqc 'select "objectKey" from "RetentionTombstone" order by "objectKey"' | while IFS= read -r object_key; do
  [[ -z "$object_key" ]] && continue
  [[ "$object_key" =~ ^[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+$ && "$object_key" != */.. ]] || { echo 'Unsafe tombstone key' >&2; exit 3; }
  if mc stat "target/${MINIO_BUCKET}/${object_key}" >/dev/null 2>&1; then
    mc rm --force "target/${MINIO_BUCKET}/${object_key}" >/dev/null
  fi
done
echo 'Restore complete; mandatory retention tombstone replay completed. Keep API disabled until integrity validation succeeds.'
