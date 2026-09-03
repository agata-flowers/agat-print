#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f compose.yaml)
report_dir="${VERIFY_REPORT_DIR:-outputs}"
mkdir -p "$report_dir"
phase="initialization"

write_report() {
  local result="$1"
  cat > "$report_dir/stage5-verification-report.json" <<JSON
{
  "result": "$result",
  "phase": "$phase",
  "scope": "tariffs-orders-price-snapshots-mock-payments-full-refunds"
}
JSON
}

write_report running
cleanup() {
  local status="$?"
  if [[ "$status" -ne 0 ]]; then
    write_report failure
    "${compose[@]}" ps >&2 || true
    "${compose[@]}" logs --no-color --tail=100 api postgres redis minio clamav >&2 || true
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
  echo "Stage 5 dependency failed its health check: $service" >&2
  return 1
}

phase="compose-build"
"${compose[@]}" config --quiet
"${compose[@]}" build api web

phase="dependency-health"
"${compose[@]}" up -d postgres redis minio clamav
for service in postgres redis minio clamav; do wait_healthy "$service"; done

phase="database-migrations"
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy

phase="production-provider-policy"
if "${compose[@]}" run --rm \
  -e NODE_ENV=production \
  -e WEB_ORIGIN=https://print.invalid \
  -e OTP_PROVIDER=sms \
  -e PAYMENT_PROVIDER=mock \
  api node -e "require('./apps/api/dist/config/environment.js').loadEnvironment()"; then
  echo 'Mock payment unexpectedly passed production validation.' >&2
  exit 1
fi
if "${compose[@]}" run --rm \
  -e NODE_ENV=production \
  -e WEB_ORIGIN=https://print.invalid \
  -e OTP_PROVIDER=sms \
  -e PAYMENT_PROVIDER=acquiring \
  -e JWT_ACCESS_SECRET=development-only-change-me-at-least-32-chars \
  api node -e "require('./apps/api/dist/config/environment.js').loadEnvironment()"; then
  echo 'Development credentials unexpectedly passed production validation.' >&2
  exit 1
fi

phase="stage5-db-e2e"
"${compose[@]}" run --rm \
  -e NODE_ENV=test \
  -e RUN_STAGE5_E2E=1 -e AFTERCARE_DISPATCH_ENABLED=false \
  -e PROCESSING_DISPATCH_ENABLED=false \
  api pnpm --filter @agat/api exec vitest run test/stage5.e2e.spec.ts --no-file-parallelism

phase="health-cache-and-telemetry"
"${compose[@]}" up -d api
wait_healthy api
headers="$(curl --fail --silent --dump-header - --output /dev/null http://localhost:4000/api/v1/health/live)"
grep -Eqi '^Cache-Control:.*no-store.*private' <<<"$headers"
metrics="$(curl --fail --silent http://localhost:4000/api/v1/metrics)"
if grep -Eqi 'order_id|user_id|payment|refund|amount|currency|phone|provider.?reference|idempotency|request_id|query' <<<"$metrics"; then
  echo 'Financial, personal, or high-cardinality metric label was found.' >&2
  exit 1
fi
logs="$("${compose[@]}" logs --no-color api 2>&1)"
if grep -Eqi '\+99800000005|providerPaymentReference|providerRefundReference|Idempotency-Key|mockSignature|amountMinor|objectKey|X-Amz-Signature' <<<"$logs"; then
  echo 'Sensitive stage 5 data was found in service logs.' >&2
  exit 1
fi
audit_leaks="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc \
  "SELECT count(*) FROM \"AuditEvent\" WHERE metadata::text ~* '(amount|price|currency|provider|reference|idempotency|phone|\\+998|object|signed)' OR metadata::text ~ '[0-9]{5,}'")"
test "$audit_leaks" = 0
grep -q '"/orders/"' apps/web/public/sw.js
grep -q '"/payments/"' apps/web/public/sw.js

phase="domain-integrity"
duplicate_payments="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc \
  'SELECT count(*) FROM (SELECT "orderId" FROM "Payment" GROUP BY "orderId" HAVING count(*) > 1) d')"
duplicate_refunds="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc \
  'SELECT count(*) FROM (SELECT "paymentId" FROM "RefundOperation" GROUP BY "paymentId" HAVING count(*) > 1) d')"
test "$duplicate_payments" = 0
test "$duplicate_refunds" = 0

phase="complete"
cat > "$report_dir/stage5-verification-report.json" <<JSON
{
  "result": "success",
  "tariffVersioningAndRbac": "passed",
  "currentLayoutEligibility": "passed",
  "immutablePriceSnapshot": "passed",
  "idempotentPaymentAndRefund": "passed",
  "callbackSignatureReplayAndOrdering": "passed",
  "productionProviderPolicy": "passed",
  "cacheAuditLogsAndMetrics": "passed"
}
JSON

git diff --check
test -z "$(git status --porcelain --untracked-files=all)"
echo 'Stage 5 pricing, payment and refund verification succeeded.'
