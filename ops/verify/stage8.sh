#!/usr/bin/env bash
set -euo pipefail
compose=(docker compose -f compose.yaml -f compose.verify.yaml --profile backup)
report_dir="${VERIFY_REPORT_DIR:-outputs}"
mkdir -p "$report_dir"
phase=initialization
rpo=null
rto=null
write_report() {
  printf '{"result":"%s","phase":"%s","rpoSeconds":%s,"rtoSeconds":%s,"scope":"disputes-reprint-refund-retention","executionEnvironment":"%s","localDockerCheck":"unavailable-executable-not-installed","requiredInfrastructure":"GitHub Actions","databaseE2E":"%s"}\n' "$1" "$phase" "$rpo" "$rto" "${GITHUB_ACTIONS:+github-actions}" "${db_e2e:-not_run}" > "$report_dir/stage8-verification-report.json"
}
write_report running
cleanup() {
  local result="$?"
  if [[ "$result" -ne 0 ]]; then
    write_report failure
    echo "Stage 8 verification failed during phase: $phase" >&2
    "${compose[@]}" ps >&2 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  return "$result"
}
trap cleanup EXIT
wait_healthy() {
  local service="$1" id status
  for _ in $(seq 1 90); do
    id="$("${compose[@]}" ps -q "$service")"
    if [[ -n "$id" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")"
      [[ "$status" == healthy ]] && return 0
    fi
    sleep 2
  done
  echo "Dependency health failed: $service" >&2
  return 1
}
phase=compose-build-health
"${compose[@]}" config --quiet
"${compose[@]}" build api web printer-agent backup restore
"${compose[@]}" up -d postgres redis minio clamav backup-minio postgres-restore minio-restore
for service in postgres redis minio clamav backup-minio postgres-restore minio-restore; do wait_healthy "$service"; done
phase=clean-repeatable-migrations
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy
phase=stage7-regression-and-stage8-db-e2e
"${compose[@]}" run --rm -e NODE_ENV=test -e RUN_STAGE8_E2E=1 \
  -e PROCESSING_DISPATCH_ENABLED=false -e MATCHING_DISPATCH_ENABLED=false \
  -e FULFILLMENT_DISPATCH_ENABLED=false -e AFTERCARE_DISPATCH_ENABLED=false \
  api pnpm --filter @agat/api exec vitest run test/stage7.e2e.spec.ts --no-file-parallelism
db_e2e=passed
phase=aftercare-worker-and-privacy
"${compose[@]}" up -d api
wait_healthy api
for _ in $(seq 1 30); do
  queue_keys="$("${compose[@]}" exec -T redis redis-cli --scan --pattern 'bull:aftercare:*' | wc -l)"
  [[ "$queue_keys" -gt 0 ]] && break
  sleep 1
done
test "$queue_keys" -gt 0
headers="$(curl --fail --silent --dump-header - --output /dev/null http://localhost:4000/api/v1/health/ready)"
grep -Eqi '^Cache-Control:.*no-store.*private' <<<"$headers"
metrics="$(curl --fail --silent http://localhost:4000/api/v1/metrics)"
if grep -Eqi 'dispute_id|resolution_id|cycle_id|object_key|signed|phone|address|payout|commission|providerReference|request_id' <<<"$metrics"; then
  echo 'Private metric label found' >&2; exit 1
fi
logs="$("${compose[@]}" logs --no-color api 2>&1)"
if grep -Eqi '\+99800000007|Synthetic reprint|structuredComment|completionPin|handoffPin|addressCiphertext|objectKey|X-Amz-Signature|partnerPayoutMinor|agatCommissionMinor' <<<"$logs"; then
  echo 'Sensitive value found in API logs' >&2; exit 1
fi
phase=backup-held-objects
# Stop writers for a reproducible disaster drill; backup also protects deletion with an advisory lock.
"${compose[@]}" stop api
"${compose[@]}" run --rm -T --entrypoint bash backup -seu <<'SCRIPT'
key="verification/$(psql -XAtqc 'SELECT gen_random_uuid()')"
printf %s 'synthetic-post-snapshot-deletion' > /tmp/ledger-fixture
checksum="$(sha256sum /tmp/ledger-fixture | cut -d' ' -f1)"
mc alias set source "$MINIO_ALIAS_URL" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
mc cp /tmp/ledger-fixture "source/$MINIO_BUCKET/$key" >/dev/null 2>&1
psql -Xq -v ON_ERROR_STOP=1 -v object_key="$key" -v checksum="$checksum" <<'SQL'
INSERT INTO "PermanentObjectReference" ("objectKey", checksum, "retentionClass", "expiresAt") VALUES (:'object_key', :'checksum', 'ORIGINAL', now() + interval '7 days');
SQL
SCRIPT
backup_started="$(date +%s)"
"${compose[@]}" run --rm backup
phase=newer-deletion-ledger
"${compose[@]}" run --rm -T --entrypoint bash backup -seu <<'SCRIPT'
psql -Xq -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "RetentionTombstone" ("objectKey", reason) SELECT "objectKey", 'STAGE8_LEDGER_DRILL' FROM "PermanentObjectReference" WHERE "objectKey" LIKE 'verification/%';
SQL
ledger_dir="$(mktemp -d)"
trap 'rm -rf "$ledger_dir"' EXIT
psql -XAtq -v ON_ERROR_STOP=1 -c 'COPY (SELECT "objectKey", reason, "deletedAt" FROM "RetentionTombstone" ORDER BY "objectKey") TO STDOUT WITH (FORMAT csv, HEADER true)' > "$ledger_dir/retention-tombstones.csv"
restic backup --quiet --tag agat-retention-ledger "$ledger_dir"
SCRIPT
phase=synthetic-source-object-loss
"${compose[@]}" run --rm -T --entrypoint bash backup -seu <<'SCRIPT'
key="$(psql -XAtqc 'SELECT v."objectKey" FROM "LegalHold" h JOIN "Order" o ON o.id=h."orderId" JOIN "PrintReadyVersion" v ON v.id=o."printReadyVersionId" WHERE h."releasedAt" IS NULL LIMIT 1')"
[[ -n "$key" ]]
mc alias set source "$MINIO_ALIAS_URL" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
mc rm --force "source/$MINIO_BUCKET/$key" >/dev/null 2>&1
if mc stat "source/$MINIO_BUCKET/$key" >/dev/null 2>&1; then exit 1; fi
SCRIPT
phase=isolated-restore
restore_started="$(date +%s)"
"${compose[@]}" run --rm restore
phase=restore-held-object-integrity
"${compose[@]}" run --rm -T --entrypoint bash restore -seu <<'SCRIPT'
held="$(psql -XAtqc 'SELECT count(*) FROM "LegalHold" WHERE "releasedAt" IS NULL')"
[[ "$held" -gt 0 ]]
ledger_count="$(psql -XAtqc 'SELECT count(*) FROM "RetentionTombstone" WHERE reason = $$STAGE8_LEDGER_DRILL$$')"
[[ "$ledger_count" == 1 ]]
mc alias set target "$MINIO_ALIAS_URL" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
psql -XAtF $'\t' -c 'SELECT DISTINCT v."objectKey", r.checksum FROM "LegalHold" h JOIN "Order" o ON o.id=h."orderId" JOIN "PrintReadyVersion" v ON v.id=o."printReadyVersionId" JOIN "PermanentObjectReference" r ON r."objectKey"=v."objectKey" WHERE h."releasedAt" IS NULL AND r."deletedAt" IS NULL' | while IFS=$'\t' read -r key checksum; do
  mc cp "target/$MINIO_BUCKET/$key" /tmp/held-object >/dev/null 2>&1
  [[ "$(sha256sum /tmp/held-object | cut -d' ' -f1)" == "$checksum" ]]
done
psql -XAtqc 'SELECT "objectKey" FROM "RetentionTombstone"' | while IFS= read -r key; do
  if mc stat "target/$MINIO_BUCKET/$key" >/dev/null 2>&1; then echo 'Deleted object resurrected' >&2; exit 1; fi
done
violations="$(psql -XAtqc 'SELECT count(*) FROM (SELECT p.id FROM "Payment" p JOIN "RefundOperation" r ON r."paymentId"=p.id GROUP BY p.id HAVING sum(r."amountMinor") > p."amountMinor") x')"
[[ "$violations" == 0 ]]
SCRIPT
restore_finished="$(date +%s)"
rpo="$((restore_started-backup_started))"
rto="$((restore_finished-restore_started))"
test "$rpo" -le 86400
test "$rto" -le 14400
phase=git-integrity
git diff --check
test -z "$(git status --porcelain --untracked-files=all)"
phase=complete
write_report success
echo 'Stage 8 verification succeeded.'
