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
trap 'rm -rf "$work_dir"' EXIT
date -u +%FT%TZ > "$work_dir/backup-created-at.txt"
pg_dump --format=custom --serializable-deferrable --file="$work_dir/postgres.dump"
printf 'object_key\tchecksum\n' > "$work_dir/minio-manifest.tsv"
if psql -Atqc "select to_regclass('public.\"PermanentObjectReference\"') is not null" | grep -qx t; then
  psql -AtF $'\t' -c 'select r."objectKey", r."checksum" from "PermanentObjectReference" r where r."deletedAt" is null and r."expiresAt" > now() and not exists (select 1 from "RetentionTombstone" t where t."objectKey" = r."objectKey") order by r."objectKey"' >> "$work_dir/minio-manifest.tsv"
fi
mc alias set source "$MINIO_ALIAS_URL" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
mc alias set offsite "$BACKUP_S3_URL" "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" >/dev/null
mc mb --ignore-existing "offsite/${BACKUP_S3_BUCKET}" >/dev/null
mkdir -p "$work_dir/minio"
tail -n +2 "$work_dir/minio-manifest.tsv" | while IFS=$'\t' read -r object_key checksum; do
  [[ -z "$object_key" ]] && continue
  mkdir -p "$(dirname "$work_dir/minio/${object_key}")"
  mc cp --quiet "source/${MINIO_BUCKET}/${object_key}" "$work_dir/minio/${object_key}"
  actual_checksum="$(sha256sum "$work_dir/minio/${object_key}" | cut -d' ' -f1)"
  [[ "$actual_checksum" == "$checksum" ]] || { echo 'Object checksum mismatch' >&2; exit 3; }
done
restic snapshots >/dev/null 2>&1 || restic init
restic backup --quiet --tag agat-print-stage2 "$work_dir"
restic forget --quiet --keep-within "${BACKUP_RETENTION_DAYS:-30}d" --prune
echo 'Encrypted off-host backup completed.'
