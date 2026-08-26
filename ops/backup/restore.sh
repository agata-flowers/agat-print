#!/usr/bin/env bash
set -euo pipefail
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"
: "${MINIO_ALIAS_URL:?MINIO_ALIAS_URL is required}"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
restic restore "${RESTIC_SNAPSHOT_ID:-latest}" --target "$work_dir"
dump="$(find "$work_dir" -name postgres.dump -print -quit)"
manifest="$(find "$work_dir" -name minio-manifest.tsv -print -quit)"
test -n "$dump" && test -n "$manifest"
pg_restore --clean --if-exists --no-owner --dbname="$PGDATABASE" "$dump"
mc alias set target "$MINIO_ALIAS_URL" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
minio_dir="$(dirname "$manifest")/minio"
tail -n +2 "$manifest" | while IFS=$'\t' read -r object_key checksum; do
  [[ -z "$object_key" ]] && continue
  printf '%s  %s\n' "$checksum" "$minio_dir/$object_key" | sha256sum -c -
  mc cp "$minio_dir/$object_key" "target/${MINIO_BUCKET}/${object_key}"
done
# Stage 3 adds the retention-tombstone replay command. API must remain disabled until it passes.
echo 'Restore complete; validate migrations, manifest references, retention tombstones and health before enabling API.'
