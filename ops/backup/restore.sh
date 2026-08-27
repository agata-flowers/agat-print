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
restic restore --quiet "${RESTIC_SNAPSHOT_ID:-latest}" --target "$work_dir"
dump="$(find "$work_dir" -name postgres.dump -print -quit)"
manifest="$(find "$work_dir" -name minio-manifest.tsv -print -quit)"
test -n "$dump" && test -n "$manifest"
pg_restore --clean --if-exists --no-owner --dbname="$PGDATABASE" "$dump"
mc alias set target "$MINIO_ALIAS_URL" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
mc mb --ignore-existing "target/${MINIO_BUCKET}" >/dev/null
mc ready target >/dev/null
minio_dir="$(dirname "$manifest")/minio"
tail -n +2 "$manifest" | while IFS=$'\t' read -r object_key checksum; do
  [[ -z "$object_key" ]] && continue
  actual_checksum="$(sha256sum "$minio_dir/$object_key" | cut -d' ' -f1)"
  [[ "$actual_checksum" == "$checksum" ]] || { echo 'Object checksum mismatch' >&2; exit 3; }
  mc cp --quiet "$minio_dir/$object_key" "target/${MINIO_BUCKET}/${object_key}"
done
psql -Atqc "select to_regclass('public.\"RetentionTombstone\"') is not null" | grep -qx t || {
  echo 'Restore rejected: retention tombstone table is unavailable' >&2; exit 4;
}
psql -Atqc 'select "objectKey" from "RetentionTombstone" order by "objectKey"' | while IFS= read -r object_key; do
  [[ -z "$object_key" ]] && continue
  if mc stat "target/${MINIO_BUCKET}/${object_key}" >/dev/null 2>&1; then
    mc rm --force "target/${MINIO_BUCKET}/${object_key}" >/dev/null
  fi
done
echo 'Restore complete; mandatory retention tombstone replay completed. Keep API disabled until integrity validation succeeds.'
