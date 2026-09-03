#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f compose.yaml)
report_dir="${VERIFY_REPORT_DIR:-outputs}"
mkdir -p "$report_dir"
phase="initialization"

write_report() {
  local result="$1"
  cat > "$report_dir/stage7-verification-report.json" <<JSON
{
  "result": "$result",
  "phase": "$phase",
  "scope": "printer-agent-pickup-pin-courier-delivery-completed"
}
JSON
}

write_report running
cleanup() {
  local status="$?"
  if [[ "$status" -ne 0 ]]; then
    echo "Stage 7 verification failed during phase: $phase" >&2
    write_report failure
    "${compose[@]}" ps >&2 || true
    "${compose[@]}" logs --no-color --tail=150 api postgres redis minio >&2 || true
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
  echo "Stage 7 dependency failed its health check: $service" >&2
  return 1
}

phase="compose-and-image-builds"
"${compose[@]}" config --quiet
"${compose[@]}" build api web printer-agent

phase="dependency-health"
"${compose[@]}" up -d postgres redis minio clamav
for service in postgres redis minio clamav; do wait_healthy "$service"; done

phase="clean-repeatable-migrations"
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy

phase="production-provider-and-secret-policy"
if "${compose[@]}" run --rm \
  -e NODE_ENV=production \
  -e WEB_ORIGIN=https://print.invalid \
  -e OTP_PROVIDER=sms \
  -e PAYMENT_PROVIDER=acquiring \
  -e DELIVERY_PROVIDER=mock \
  -e MOCK_OTP_CODE= \
  -e MOCK_PAYMENT_SECRET= \
  -e JWT_ACCESS_SECRET='q7Ve4!Tn9#Lm2@Rx8$Bp5%Kd1&Hs6*Wz' \
  -e MINIO_ACCESS_KEY=prod-access-9A7b6C5d \
  -e MINIO_SECRET_KEY=prod-minio-9A7b6C5d4E3f2G1h \
  api node -e "require('./apps/api/dist/config/environment.js').loadEnvironment()"; then
  echo 'Mock delivery unexpectedly passed production validation.' >&2
  exit 1
fi
if "${compose[@]}" run --rm \
  -e NODE_ENV=production \
  -e WEB_ORIGIN=https://print.invalid \
  -e OTP_PROVIDER=sms \
  -e PAYMENT_PROVIDER=acquiring \
  -e DELIVERY_PROVIDER=dispatch \
  -e MOCK_OTP_CODE= \
  -e MOCK_PAYMENT_SECRET= \
  -e JWT_ACCESS_SECRET='q7Ve4!Tn9#Lm2@Rx8$Bp5%Kd1&Hs6*Wz' \
  -e MINIO_ACCESS_KEY=prod-access-9A7b6C5d \
  -e MINIO_SECRET_KEY=prod-minio-9A7b6C5d4E3f2G1h \
  -e DELIVERY_DATA_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY= \
  -e PRINTER_AGENT_TOKEN_PEPPER=8J7k6L5m4N3p2Q1r9A7b6C5d4E3f2G1h \
  -e PICKUP_PIN_SECRET=development-only-pickup-pin-secret \
  api node -e "require('./apps/api/dist/config/environment.js').loadEnvironment()"; then
  echo 'Development stage 7 secrets unexpectedly passed production validation.' >&2
  exit 1
fi

phase="stage7-db-e2e"
"${compose[@]}" run --rm \
  -e NODE_ENV=test \
  -e RUN_STAGE7_E2E=1 -e AFTERCARE_DISPATCH_ENABLED=false \
  -e PROCESSING_DISPATCH_ENABLED=false \
  -e MATCHING_DISPATCH_ENABLED=false \
  -e FULFILLMENT_DISPATCH_ENABLED=false \
  api pnpm --filter @agat/api exec vitest run test/stage7.e2e.spec.ts --no-file-parallelism

phase="bullmq-health-cache-and-telemetry"
"${compose[@]}" up -d api
wait_healthy api
for _ in $(seq 1 30); do
  queue_keys="$("${compose[@]}" exec -T redis redis-cli --scan --pattern 'bull:order-fulfillment:*' | wc -l)"
  [[ "$queue_keys" -gt 0 ]] && break
  sleep 1
done
test "$queue_keys" -gt 0
headers="$(curl --fail --silent --dump-header - --output /dev/null http://localhost:4000/api/v1/health/live)"
grep -Eqi '^Cache-Control:.*no-store.*private' <<<"$headers"
metrics="$(curl --fail --silent http://localhost:4000/api/v1/metrics)"
if grep -Eqi 'courier_id|delivery_id|agent_id|job_id|order_id|user_id|phone|address|pin|token|object|signed|payout|commission|request_id|query' <<<"$metrics"; then
  echo 'Stage 7 private or high-cardinality metric label was found.' >&2
  exit 1
fi
logs="$("${compose[@]}" logs --no-color api 2>&1)"
if grep -Eqi '\+99800000007|Synthetic street|completionPin|handoffPin|addressCiphertext|tokenDigest|objectKey|X-Amz-Signature|partnerPayoutMinor|agatCommissionMinor' <<<"$logs"; then
  echo 'Sensitive stage 7 data was found in service logs.' >&2
  exit 1
fi
audit_leaks="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc \
  "SELECT count(*) FROM \"AuditEvent\" WHERE metadata::text ~* '(phone|address|pin|token|object|signed|payout|commission|amount|currency|provider|reference|idempotency)' OR metadata::text ~ '[0-9]{5,}'")"
test "$audit_leaks" = 0

phase="domain-integrity"
duplicate_fulfillments="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc \
  'SELECT count(*) FROM (SELECT "orderId" FROM "OrderFulfillment" GROUP BY "orderId" HAVING count(*) > 1) d')"
duplicate_deliveries="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc \
  'SELECT count(*) FROM (SELECT "orderId" FROM "DeliveryTask" GROUP BY "orderId" HAVING count(*) > 1) d')"
duplicate_print_jobs="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc \
  'SELECT count(*) FROM (SELECT "orderId" FROM "PrintJob" GROUP BY "orderId" HAVING count(*) > 1) d')"
duplicate_active_couriers="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc \
  'SELECT count(*) FROM (SELECT "courierId" FROM "DeliveryTask" WHERE active GROUP BY "courierId" HAVING count(*) > 1) d')"
plaintext_pin_columns="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc \
  "SELECT count(*) FROM information_schema.columns WHERE table_name IN ('OrderFulfillment','DeliveryTask') AND column_name ~* '(^|_)pin$|pinPlain|plainPin'")"
test "$duplicate_fulfillments" = 0
test "$duplicate_deliveries" = 0
test "$duplicate_print_jobs" = 0
test "$duplicate_active_couriers" = 0
test "$plaintext_pin_columns" = 0

phase="complete"
cat > "$report_dir/stage7-verification-report.json" <<JSON
{
  "result": "success",
  "cleanRepeatableMigrations": "passed",
  "printerAgentMachineAuthLeaseAndIdempotency": "passed",
  "manualAndAgentProductionRaceProtection": "passed",
  "pickupPinDigestTtlAttemptsAndOneTimeUse": "passed",
  "encryptedDeliveryAddress": "passed",
  "courierApprovalDeterministicAssignmentAndIsolation": "passed",
  "partnerCourierHandoff": "passed",
  "deliveryFailureAndCompletedTransitions": "passed",
  "immutableFinancialSnapshotsAndClientIsolation": "passed",
  "bullMqRedelivery": "passed",
  "cacheAuditLogsAndMetrics": "passed",
  "stage8Boundary": "passed"
}
JSON

git diff --check
test -z "$(git status --porcelain --untracked-files=all)"
echo 'Stage 7 printer-agent, pickup and delivery verification succeeded.'
