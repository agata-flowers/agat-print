#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f compose.yaml -f compose.verify.yaml --profile backup)
report_dir="${VERIFY_REPORT_DIR:-outputs}"
mkdir -p "$report_dir"

cleanup() {
  local status="$?"
  if [[ "$status" -ne 0 ]]; then
    "${compose[@]}" ps >&2 || true
    "${compose[@]}" logs --no-color --tail=100 api web postgres redis minio \
      backup-minio postgres-restore minio-restore >&2 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  return "$status"
}
trap cleanup EXIT

wait_healthy() {
  local service="$1"
  local container_id status
  for _ in $(seq 1 60); do
    container_id="$("${compose[@]}" ps -q "$service")"
    if [[ -n "$container_id" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
      [[ "$status" == healthy || "$status" == running ]] && return 0
    fi
    sleep 2
  done
  echo "Service failed its health check: ${service}" >&2
  "${compose[@]}" ps >&2
  return 1
}

expect_startup_rejection() {
  local label="$1"
  shift
  if "${compose[@]}" run --rm "$@" api node apps/api/dist/main.js >/dev/null 2>&1; then
    echo "Expected production startup rejection did not occur: ${label}" >&2
    return 1
  fi
}

echo 'Verifying Compose configuration and building all stage 2 images.'
"${compose[@]}" config --quiet
"${compose[@]}" build api web backup restore

"${compose[@]}" up -d postgres redis minio backup-minio postgres-restore minio-restore
for service in postgres redis minio backup-minio postgres-restore minio-restore; do
  wait_healthy "$service"
done

echo 'Applying migrations to a clean database twice.'
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy

echo 'Running all database E2E tests.'
"${compose[@]}" run --rm -e NODE_ENV=test -e RUN_DB_E2E=1 api \
  pnpm --filter @agat/api test -- foundation.e2e.spec.ts

echo 'Verifying production rejection of mock OTP and development secrets.'
expect_startup_rejection mock-otp \
  -e NODE_ENV=production \
  -e WEB_ORIGIN=https://agat.example \
  -e OTP_PROVIDER=mock \
  -e MOCK_OTP_CODE= \
  -e JWT_ACCESS_SECRET='q7Ve4!Tn9#Lm2@Rx8$Bp5%Kd1&Hs6*Wz'
expect_startup_rejection development-secret \
  -e NODE_ENV=production \
  -e WEB_ORIGIN=https://agat.example \
  -e OTP_PROVIDER=sms \
  -e MOCK_OTP_CODE= \
  -e JWT_ACCESS_SECRET=development-only-change-me-at-least-32-chars

"${compose[@]}" up -d api web
wait_healthy api
wait_healthy web
curl --fail --silent http://localhost:4000/api/v1/health/live >/dev/null
curl --fail --silent http://localhost:4000/api/v1/health/ready >/dev/null
curl --fail --silent http://localhost:3000 >/dev/null

echo 'Creating synthetic database references and private objects.'
"${compose[@]}" run --rm --entrypoint bash backup -ceu '
  retained_key="verification/retained.bin"
  tombstoned_key="verification/tombstoned.bin"
  printf %s "stage2-retained-object" > /tmp/retained.bin
  printf %s "stage2-tombstoned-object" > /tmp/tombstoned.bin
  retained_checksum="$(sha256sum /tmp/retained.bin | cut -d" " -f1)"
  tombstoned_checksum="$(sha256sum /tmp/tombstoned.bin | cut -d" " -f1)"
  mc alias set source "$MINIO_ALIAS_URL" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
  mc mb --ignore-existing "source/$MINIO_BUCKET" >/dev/null
  mc cp --quiet /tmp/retained.bin "source/$MINIO_BUCKET/$retained_key"
  mc cp --quiet /tmp/tombstoned.bin "source/$MINIO_BUCKET/$tombstoned_key"
  psql -v ON_ERROR_STOP=1 \
    -v retained_key="$retained_key" -v retained_checksum="$retained_checksum" \
    -v tombstoned_key="$tombstoned_key" -v tombstoned_checksum="$tombstoned_checksum" <<"SQL"
INSERT INTO "PermanentObjectReference" ("objectKey", checksum, "retentionClass", "expiresAt")
VALUES (:'retained_key', :'retained_checksum', 'ORIGINAL', now() + interval '7 days');
INSERT INTO "PermanentObjectReference" ("objectKey", checksum, "retentionClass", "expiresAt")
VALUES (:'tombstoned_key', :'tombstoned_checksum', 'PRINT_READY', now() + interval '30 days');
INSERT INTO "RetentionTombstone" ("objectKey", reason)
VALUES (:'tombstoned_key', 'retention-expired');
SQL
'

backup_started="$(date +%s)"
"${compose[@]}" run --rm backup

echo 'Deleting source data and seeding a stale object in the isolated restore target.'
"${compose[@]}" run --rm --entrypoint bash backup -ceu '
  retained_key="verification/retained.bin"
  tombstoned_key="verification/tombstoned.bin"
  mc alias set source "$MINIO_ALIAS_URL" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
  mc rm --force "source/$MINIO_BUCKET/$retained_key" >/dev/null
  mc rm --force "source/$MINIO_BUCKET/$tombstoned_key" >/dev/null
  psql -v ON_ERROR_STOP=1 -v retained_key="$retained_key" \
    -c "DELETE FROM \"PermanentObjectReference\" WHERE \"objectKey\" = :'retained_key'" >/dev/null
'
"${compose[@]}" run --rm --entrypoint bash restore -ceu '
  tombstoned_key="verification/tombstoned.bin"
  printf %s "stale-copy-that-must-be-deleted" > /tmp/stale.bin
  mc alias set target "$MINIO_ALIAS_URL" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
  mc mb --ignore-existing "target/$MINIO_BUCKET" >/dev/null
  mc cp --quiet /tmp/stale.bin "target/$MINIO_BUCKET/$tombstoned_key"
'

restore_started="$(date +%s)"
"${compose[@]}" run --rm restore
restore_finished="$(date +%s)"

echo 'Validating the restored database, manifest object, checksum and tombstone replay.'
"${compose[@]}" run --rm --entrypoint bash restore -ceu '
  retained_key="verification/retained.bin"
  tombstoned_key="verification/tombstoned.bin"
  retained_count="$(psql -Atqc "SELECT count(*) FROM \"PermanentObjectReference\" WHERE \"objectKey\" = '\''$retained_key'\''")"
  tombstone_count="$(psql -Atqc "SELECT count(*) FROM \"RetentionTombstone\" WHERE \"objectKey\" = '\''$tombstoned_key'\''")"
  [[ "$retained_count" == 1 && "$tombstone_count" == 1 ]]
  expected_checksum="$(psql -Atqc "SELECT trim(checksum) FROM \"PermanentObjectReference\" WHERE \"objectKey\" = '\''$retained_key'\''")"
  mc alias set target "$MINIO_ALIAS_URL" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
  mc cp --quiet "target/$MINIO_BUCKET/$retained_key" /tmp/restored.bin
  actual_checksum="$(sha256sum /tmp/restored.bin | cut -d" " -f1)"
  [[ "$actual_checksum" == "$expected_checksum" ]]
  if mc stat "target/$MINIO_BUCKET/$tombstoned_key" >/dev/null 2>&1; then
    echo "Retention tombstone replay failed" >&2
    exit 1
  fi
'
"${compose[@]}" run --rm \
  -e DATABASE_URL=postgresql://agat:restore-ci-only@postgres-restore:5432/agat_restore?schema=public \
  api pnpm --filter @agat/api exec prisma migrate deploy

rpo_seconds="$((restore_started - backup_started))"
rto_seconds="$((restore_finished - restore_started))"
cat > "$report_dir/stage2-verification-report.json" <<JSON
{
  "result": "success",
  "rpoSeconds": ${rpo_seconds},
  "rtoSeconds": ${rto_seconds},
  "rpoTargetSeconds": 86400,
  "rtoTargetSeconds": 14400,
  "postgresRestore": "verified",
  "minioManifest": "verified",
  "retentionTombstones": "applied",
  "sourceDeletion": "verified"
}
JSON

[[ "$rpo_seconds" -le 86400 && "$rto_seconds" -le 14400 ]]
git diff --check
[[ -z "$(git status --porcelain --untracked-files=all)" ]]
echo "Stage 2 infrastructure verification succeeded. RPO=${rpo_seconds}s RTO=${rto_seconds}s."
