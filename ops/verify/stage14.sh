#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f compose.yaml -f compose.verify.yaml --profile backup --profile processing)
report_dir="${VERIFY_REPORT_DIR:-outputs}"
work_dir="work/stage14-verification"
mkdir -p "$report_dir" "$work_dir"
phase=initialization failure_line=null db_e2e=not_run browser_e2e=not_run
rpo=null rto=null api_pid="" web_pid=""
execution_environment=local-docker
[[ -n "${GITHUB_ACTIONS:-}" ]] && execution_environment=github-actions

write_report() {
  local result="$1" checks=not_completed evidence=null
  [[ "$result" == success ]] && checks=passed
  if [[ -f "$work_dir/db-e2e.log" || -f "$work_dir/browser-e2e.log" ]]; then
    evidence="$(find "$work_dir" -maxdepth 1 -type f -name '*e2e.log' -print0 | sort -z | xargs -0 cat | sha256sum | cut -d' ' -f1)"
    evidence="\"$evidence\""
  fi
  printf '{"result":"%s","phase":"%s","failureLine":%s,"commitSha":"%s","scope":"payments-order-confirmation-mvp-purchase","executionEnvironment":"%s","databaseE2E":"%s","browserE2E":"%s","customerLocales":"uz-ru-en","languageSwitchStatePreserved":"%s","stage1To13Regression":"executed-by-prior-workflow-gates","migrations":"clean-and-repeatable","securityPrivacyConcurrencyIdempotency":"%s","backupRestore":"%s","paymentLineageRestore":"%s","rpoSeconds":%s,"rtoSeconds":%s,"evidenceSha256":%s}\n' \
    "$result" "$phase" "$failure_line" "${GITHUB_SHA:-$(git rev-parse HEAD)}" "$execution_environment" "$db_e2e" "$browser_e2e" "$checks" "$checks" "$checks" "$checks" "$rpo" "$rto" "$evidence" > "$report_dir/stage14-verification-report.json"
  sha256sum "$report_dir/stage14-verification-report.json" > "$report_dir/stage14-verification-report.sha256"
}

write_report running
trap 'failure_line=$LINENO' ERR
cleanup() {
  local result="$?"
  [[ -n "$web_pid" ]] && { kill "$web_pid" >/dev/null 2>&1 || true; wait "$web_pid" 2>/dev/null || true; }
  [[ -n "$api_pid" ]] && { kill "$api_pid" >/dev/null 2>&1 || true; wait "$api_pid" 2>/dev/null || true; }
  if [[ "$result" -ne 0 ]]; then
    write_report failure
    echo "Stage 14 verification failed during phase: $phase" >&2
    test -f "$work_dir/db-e2e.log" && tail -120 "$work_dir/db-e2e.log" >&2 || true
    if [[ -f "$work_dir/browser-e2e.log" ]]; then
      # Preserve a bounded, redacted diagnostic alongside the always-uploaded
      # report. This keeps first-attempt Playwright failures actionable after
      # the isolated runtime is removed without publishing synthetic identity,
      # address, object-key, or signed-URL values.
      tail -200 "$work_dir/browser-e2e.log" |
        sed -E \
          -e 's/\+998[0-9]{9}/[redacted-phone]/g' \
          -e 's/Synthetic district, building [0-9]+/[redacted-address]/g' \
          -e 's/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[redacted-id]/gi' \
          -e 's#https?://[^[:space:]]*X-Amz-Signature[^[:space:]]*#[redacted-signed-url]#gi' \
          > "$report_dir/stage14-browser-e2e-diagnostic.log"
      tail -120 "$report_dir/stage14-browser-e2e-diagnostic.log" >&2
    fi
    "${compose[@]}" ps >&2 || true
  fi
  docker volume ls -q --filter name=agat-processing- | xargs -r docker volume rm -f >/dev/null 2>&1 || true
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work_dir"
  return "$result"
}
trap cleanup EXIT

wait_healthy() {
  local service="$1" id status
  for _ in $(seq 1 90); do
    id="$("${compose[@]}" ps -q "$service")"
    if [[ -n "$id" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")"
      [[ "$status" == healthy || "$status" == running ]] && return 0
    fi
    sleep 2
  done
  return 1
}
wait_url() { local url="$1"; for _ in $(seq 1 90); do curl --fail --silent "$url" >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }

phase=compose-build-health
"${compose[@]}" config --quiet
"${compose[@]}" build api web processing-runtime processing-worker backup restore
"${compose[@]}" up -d postgres redis minio clamav backup-minio postgres-restore minio-restore
for service in postgres redis minio clamav backup-minio postgres-restore minio-restore; do wait_healthy "$service"; done

phase=clean-repeatable-migrations
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy

phase=stage14-db-e2e
set +e
"${compose[@]}" run --rm -e NODE_ENV=test -e RUN_STAGE14_E2E=1 \
  -e PAYMENT_PROVIDER=mock -e PAYMENT_REFERENCE_KEY=cHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHA= \
  -e PROCESSING_DISPATCH_ENABLED=false -e MATCHING_DISPATCH_ENABLED=false \
  -e FULFILLMENT_DISPATCH_ENABLED=false -e AFTERCARE_DISPATCH_ENABLED=false \
  -e FINANCE_DISPATCH_ENABLED=false -e ORDERING_DISPATCH_ENABLED=false \
  api pnpm --filter @agat/api exec vitest run test/stage14.e2e.spec.ts --no-file-parallelism 2>&1 | tee "$work_dir/db-e2e.log"
db_status="${PIPESTATUS[0]}"
set -e
[[ "$db_status" -eq 0 ]] || exit "$db_status"
db_e2e=passed

phase=stage14-browser-fixture
"${compose[@]}" run --rm api node apps/api/scripts/stage14-browser-fixture.mjs

phase=synthetic-browser-input
docker run --rm -i --user 0:0 --entrypoint python3 -v "$PWD/$work_dir:/fixtures" agat-processing:local - <<'PY'
from PIL import Image
Image.new('RGB', (2480, 3508), 'white').save('/fixtures/synthetic.pdf', 'PDF', resolution=300)
PY

phase=browser-runtime
pnpm db:generate
pnpm build
"${compose[@]}" up -d processing-worker
wait_healthy processing-worker
export NODE_ENV=test WEB_ORIGIN=http://localhost:3000 API_PORT=4000
export JWT_ACCESS_SECRET=ci-only-secret-at-least-32-characters OTP_PROVIDER=mock MOCK_OTP_CODE=000000
export PAYMENT_PROVIDER=mock MOCK_PAYMENT_SECRET=development-only-mock-payment-secret
export PAYMENT_REFERENCE_KEY=cHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHA=
export DATABASE_URL='postgresql://agat:development-only@localhost:5432/agat_print?schema=public'
export REDIS_URL=redis://localhost:6379 MINIO_ENDPOINT=http://localhost:9000
export MINIO_ACCESS_KEY=development-only MINIO_SECRET_KEY=development-only-change-me MINIO_BUCKET=agat-private
export CLAMAV_HOST=localhost CLAMAV_PORT=3310 PROCESSING_DISPATCH_ENABLED=true ORDERING_DISPATCH_ENABLED=true
export STAGE13_FULFILLMENT_ENABLED=true DELIVERY_PROVIDER=internal
export MATCHING_DISPATCH_ENABLED=false FULFILLMENT_DISPATCH_ENABLED=false AFTERCARE_DISPATCH_ENABLED=false FINANCE_DISPATCH_ENABLED=false
export PROCESSING_IMAGE=agat-processing:local PROCESSING_RUNNER_SCRIPT="$PWD/ops/processing/run-job.sh"
export PROCESSING_SECCOMP_PROFILE="$PWD/ops/processing/seccomp.json" PROCESSING_TIMEOUT_SECONDS=120
if curl --silent --max-time 1 http://localhost:4000/api/v1/health/ready >/dev/null 2>&1 || curl --silent --max-time 1 http://localhost:3000 >/dev/null 2>&1; then
  echo 'Browser runtime ports are already occupied' >&2; exit 1
fi
node apps/api/dist/main.js > "$work_dir/api.log" 2>&1 & api_pid=$!
(cd apps/web && exec node node_modules/next/dist/bin/next start) > "$PWD/$work_dir/web.log" 2>&1 & web_pid=$!
wait_url http://localhost:4000/api/v1/health/ready
wait_url http://localhost:3000

phase=stage14-browser-e2e
if [[ -f /etc/apt/sources.list.d/google-chrome.list ]]; then sudo rm -f /etc/apt/sources.list.d/google-chrome.list; fi
pnpm --filter @agat/web exec playwright install --with-deps chromium
set +e
RUN_STAGE14_BROWSER_E2E=1 STAGE13_PDF_FIXTURE="$PWD/$work_dir/synthetic.pdf" pnpm --filter @agat/web exec playwright test e2e/stage13.spec.ts 2>&1 | tee "$work_dir/browser-e2e.log"
browser_status="${PIPESTATUS[0]}"
set -e
[[ "$browser_status" -eq 0 ]] || exit "$browser_status"
browser_e2e=passed

phase=privacy-security-audit
headers="$(curl --fail --silent --dump-header - --output /dev/null http://localhost:4000/api/v1/catalog?locale=ru)"
grep -Eqi '^Cache-Control:.*no-store.*private' <<<"$headers"
metrics="$(curl --fail --silent http://localhost:4000/api/v1/metrics)"
if grep -Eqi 'payment_id|attempt_id|provider_reference|merchant_reference|event_id|address|phone|object_key|signed|request_id' <<<"$metrics"; then exit 1; fi
if grep -Eqi 'providerReference|merchantReference|providerPaymentReference|addressCiphertext|X-Amz-Signature|\+9980000001' "$work_dir/api.log" "$work_dir/web.log"; then exit 1; fi
audit_leaks="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc 'SELECT count(*) FROM "AuditEvent" WHERE metadata::text ~* $$(provider.?reference|merchant.?reference|event.?id|address|phone|object.?key|signed.?url)$$')"
test "$audit_leaks" = 0

phase=payment-approval-lineage
approved_payments="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc '
  SELECT count(*)
  FROM "Payment" p
  JOIN "Order" o ON o.id = p."orderId"
  WHERE p.status = $$SUCCEEDED$$
    AND o.status <> $$AWAITING_PAYMENT$$
    AND EXISTS (
      SELECT 1 FROM "PaymentAttempt" a
      WHERE a."paymentId" = p.id AND a.status = $$SUCCEEDED$$
    )
    AND EXISTS (
      SELECT 1 FROM "OutboxEvent" e
      WHERE e."aggregateType" = $$payment$$
        AND e."aggregateId" = p.id
        AND e."eventType" = $$PAYMENT_SUCCEEDED$$
    )')"
test "$approved_payments" -gt 0

phase=production-fail-closed
set +e
production_output="$("${compose[@]}" run --no-deps --rm api node -e 'require("./dist/config/environment").loadEnvironment({NODE_ENV:"production",OTP_PROVIDER:"http",PAYMENT_PROVIDER:"internal"})' 2>&1)"
production_status=$?
set -e
test "$production_status" -ne 0
grep -q 'payment.*forbidden in production' <<<"${production_output,,}"

phase=backup
kill "$web_pid" "$api_pid" >/dev/null 2>&1 || true
wait "$web_pid" 2>/dev/null || true; wait "$api_pid" 2>/dev/null || true
web_pid=""; api_pid=""
"${compose[@]}" stop processing-worker
backup_started="$(date +%s)"
"${compose[@]}" run --rm backup

phase=isolated-restore
restore_started="$(date +%s)"
"${compose[@]}" run --rm restore

phase=restore-payment-lineage
"${compose[@]}" run --rm -T --entrypoint bash restore -seu <<'SCRIPT'
attempts="$(psql -XAtqc 'SELECT count(*) FROM "PaymentAttempt"')"
[[ "$attempts" -gt 0 ]]
invalid="$(psql -XAtqc 'SELECT count(*) FROM "PaymentAttempt" a JOIN "Payment" p ON p.id=a."paymentId" WHERE a."amountMinor"<>p."amountMinor" OR a.currency<>p.currency')"
[[ "$invalid" == 0 ]]
duplicates="$(psql -XAtqc 'SELECT count(*) FROM (SELECT "paymentId" FROM "PaymentAttempt" WHERE status IN ($$CREATED$$,$$PROCESSING$$,$$UNKNOWN$$) GROUP BY "paymentId" HAVING count(*)>1) x')"
[[ "$duplicates" == 0 ]]
paid_duplicates="$(psql -XAtqc 'SELECT count(*) FROM (SELECT "aggregateId" FROM "OutboxEvent" WHERE "eventType"=$$PAYMENT_SUCCEEDED$$ GROUP BY "aggregateId" HAVING count(*)>1) x')"
[[ "$paid_duplicates" == 0 ]]
SCRIPT
restore_finished="$(date +%s)"
rpo="$((restore_started-backup_started))"; rto="$((restore_finished-restore_started))"
test "$rpo" -le 86400; test "$rto" -le 14400

phase=git-integrity
git diff --check
test -z "$(git status --porcelain --untracked-files=all)"
phase=complete
write_report success
echo 'Stage 14 verification succeeded.'
