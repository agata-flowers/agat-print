#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f compose.yaml)
report_dir="${VERIFY_REPORT_DIR:-outputs}"
mkdir -p "$report_dir"
phase="initialization"

write_report() {
  local result="$1"
  cat > "$report_dir/stage6-verification-report.json" <<JSON
{
  "result": "$result",
  "phase": "$phase",
  "scope": "partner-matching-offers-payout-snapshots-manual-production-ready"
}
JSON
}

write_report running
cleanup() {
  local status="$?"
  if [[ "$status" -ne 0 ]]; then
    write_report failure
    "${compose[@]}" ps >&2 || true
    "${compose[@]}" logs --no-color --tail=120 api postgres redis minio >&2 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  return "$status"
}
trap cleanup EXIT

wait_healthy() {
  local service="$1" container_id status
  for _ in $(seq 1 90); do
    container_id="$("${compose[@]}" ps -q "$service")"
    if [[ -n "$container_id" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
      [[ "$status" == healthy || "$status" == running ]] && return 0
    fi
    sleep 2
  done
  echo "Stage 6 dependency failed its health check: $service" >&2
  return 1
}

phase="compose-build"
"${compose[@]}" config --quiet
"${compose[@]}" build api web

phase="dependency-health"
"${compose[@]}" up -d postgres redis minio clamav
for service in postgres redis minio clamav; do wait_healthy "$service"; done

phase="clean-repeatable-migrations"
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy

phase="stage6-db-e2e"
"${compose[@]}" run --rm \
  -e NODE_ENV=test \
  -e RUN_STAGE6_E2E=1 \
  -e PROCESSING_DISPATCH_ENABLED=false \
  -e MATCHING_DISPATCH_ENABLED=false \
  api pnpm --filter @agat/api exec vitest run test/stage6.e2e.spec.ts --no-file-parallelism

phase="bullmq-health-cache-and-telemetry"
"${compose[@]}" up -d api
wait_healthy api
for _ in $(seq 1 30); do
  queue_keys="$("${compose[@]}" exec -T redis redis-cli --scan --pattern 'bull:partner-matching:*' | wc -l)"
  [[ "$queue_keys" -gt 0 ]] && break
  sleep 1
done
test "$queue_keys" -gt 0
headers="$(curl --fail --silent --dump-header - --output /dev/null http://localhost:4000/api/v1/health/live)"
grep -Eqi '^Cache-Control:.*no-store.*private' <<<"$headers"
metrics="$(curl --fail --silent http://localhost:4000/api/v1/metrics)"
if grep -Eqi 'partner_id|branch_id|offer_id|assignment_id|order_id|payout|commission|object|signed|phone|address|request_id|query' <<<"$metrics"; then
  echo 'Stage 6 private or high-cardinality metric label was found.' >&2
  exit 1
fi
logs="$("${compose[@]}" logs --no-color api 2>&1)"
if grep -Eqi '\+99800000006|objectKey|X-Amz-Signature|partnerPayoutMinor|agatCommissionMinor|Idempotency-Key|phone|address' <<<"$logs"; then
  echo 'Sensitive stage 6 data was found in service logs.' >&2
  exit 1
fi
audit_leaks="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc \
  "SELECT count(*) FROM \"AuditEvent\" WHERE metadata::text ~* '(payout|commission|amount|currency|phone|address|object|signed|idempotency)' OR metadata::text ~ '[0-9]{5,}'")"
test "$audit_leaks" = 0

phase="domain-integrity"
active_duplicates="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc \
  'SELECT count(*) FROM (SELECT "orderId" FROM "PartnerAssignment" WHERE active GROUP BY "orderId" HAVING count(*) > 1) d')"
snapshot_gaps="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc \
  'SELECT count(*) FROM "PartnerOffer" o LEFT JOIN "PartnerPayoutSnapshot" p ON p."offerId"=o.id WHERE p.id IS NULL')"
duplicate_refunds="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc \
  'SELECT count(*) FROM (SELECT "paymentId" FROM "RefundOperation" GROUP BY "paymentId" HAVING count(*) > 1) d')"
test "$active_duplicates" = 0
test "$snapshot_gaps" = 0
test "$duplicate_refunds" = 0

phase="scope-boundary"
if grep -ERn 'AWAITING_PICKUP|COURIER_ASSIGNED|IN_DELIVERY|COMPLETED|print-agent|pickup.?pin' apps/api/src apps/web/app; then
  echo 'Stage 7 implementation marker found in executable stage 6 code.' >&2
  exit 1
fi

phase="complete"
cat > "$report_dir/stage6-verification-report.json" <<JSON
{
  "result": "success",
  "cleanRepeatableMigrations": "passed",
  "approvedActiveCompatibleFiltering": "passed",
  "deterministicCandidateOrder": "passed",
  "offerTtlRejectExpiryAndRetry": "passed",
  "acceptanceCasAndUniqueAssignment": "passed",
  "immutablePartnerPayoutSnapshot": "passed",
  "partnerOwnershipAndPrintReadyAccess": "passed",
  "manualProductionThroughReady": "passed",
  "singleExhaustionRefund": "passed",
  "bullMqRedelivery": "passed",
  "cacheAuditLogsAndMetrics": "passed",
  "stage7Boundary": "passed"
}
JSON

git diff --check
test -z "$(git status --porcelain --untracked-files=all)"
echo 'Stage 6 matching and manual production verification succeeded.'
