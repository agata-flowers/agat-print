#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f compose.yaml -f compose.verify.yaml --profile backup --profile processing)
report_dir="${VERIFY_REPORT_DIR:-outputs}"
work_dir="work/stage11-verification"
mkdir -p "$report_dir" "$work_dir"
phase=initialization
rpo=null
rto=null
db_e2e=not_run
browser_e2e=not_run
failure_line=null
api_pid=""
web_pid=""
execution_environment=local-docker
[[ -n "${GITHUB_ACTIONS:-}" ]] && execution_environment=github-actions

write_report() {
  local result="$1" checks=not_completed
  [[ "$result" == success ]] && checks=passed
  printf '{"result":"%s","phase":"%s","failureLine":%s,"commitSha":"%s","scope":"customer-ordering-service-catalog-mvp","executionEnvironment":"%s","databaseE2E":"%s","browserE2E":"%s","stage1To10Regression":"executed-by-prior-workflow-gates","migrations":"clean-and-repeatable","securityPrivacyConcurrencyIdempotency":"%s","backupRestore":"%s","rpoSeconds":%s,"rtoSeconds":%s}\n' \
    "$result" "$phase" "$failure_line" "${GITHUB_SHA:-$(git rev-parse HEAD)}" "$execution_environment" "$db_e2e" "$browser_e2e" "$checks" "$checks" "$rpo" "$rto" > "$report_dir/stage11-verification-report.json"
}

write_report running
trap 'failure_line=$LINENO' ERR
cleanup() {
  local result="$?"
  [[ -n "$web_pid" ]] && kill "$web_pid" >/dev/null 2>&1 || true
  [[ -n "$api_pid" ]] && kill "$api_pid" >/dev/null 2>&1 || true
  if [[ "$result" -ne 0 ]]; then
    write_report failure
    echo "Stage 11 verification failed during phase: $phase" >&2
    test -f "$work_dir/api.log" && tail -100 "$work_dir/api.log" >&2 || true
    test -f "$work_dir/web.log" && tail -100 "$work_dir/web.log" >&2 || true
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
  echo "Dependency health failed: $service" >&2
  return 1
}

wait_url() {
  local url="$1"
  for _ in $(seq 1 90); do curl --fail --silent "$url" >/dev/null 2>&1 && return 0; sleep 2; done
  echo "Endpoint did not become ready: $url" >&2
  return 1
}

phase=compose-build-health
"${compose[@]}" config --quiet
"${compose[@]}" build api web processing-runtime processing-worker backup restore
"${compose[@]}" up -d postgres redis minio clamav backup-minio postgres-restore minio-restore
for service in postgres redis minio clamav backup-minio postgres-restore minio-restore; do wait_healthy "$service"; done

phase=clean-repeatable-migrations
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy

phase=stage11-db-e2e
set +e
"${compose[@]}" run --rm -e NODE_ENV=test -e RUN_STAGE11_E2E=1 \
  -e PROCESSING_DISPATCH_ENABLED=false -e MATCHING_DISPATCH_ENABLED=false \
  -e FULFILLMENT_DISPATCH_ENABLED=false -e AFTERCARE_DISPATCH_ENABLED=false \
  -e FINANCE_DISPATCH_ENABLED=false -e ORDERING_DISPATCH_ENABLED=false \
  api pnpm --filter @agat/api exec vitest run test/stage11.e2e.spec.ts --no-file-parallelism 2>&1 | tee "$work_dir/db-e2e.log"
db_status="${PIPESTATUS[0]}"
set -e
if [[ "$db_status" -ne 0 ]]; then
  summary="$(grep -E 'FAIL|AssertionError|expected|Error:|Test Files|Tests ' "$work_dir/db-e2e.log" | tail -12 | sed -E 's/[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}/[id]/g; s/\+998[0-9]+/[phone]/g; s#(quarantine|objects|previews|print-ready)/[^ ]+#[object]/#g' | paste -sd ';' -)"
  summary="${summary//'%'/'%25'}"
  summary="${summary//$'\n'/'%0A'}"
  summary="${summary//$'\r'/'%0D'}"
  echo "::error title=Stage 11 DB-E2E failure::${summary:-no-safe-summary}"
  exit "$db_status"
fi
db_e2e=passed

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
export DATABASE_URL='postgresql://agat:development-only@localhost:5432/agat_print?schema=public'
export REDIS_URL=redis://localhost:6379 MINIO_ENDPOINT=http://localhost:9000
export MINIO_ACCESS_KEY=development-only MINIO_SECRET_KEY=development-only-change-me MINIO_BUCKET=agat-private
export CLAMAV_HOST=localhost CLAMAV_PORT=3310 PROCESSING_DISPATCH_ENABLED=true ORDERING_DISPATCH_ENABLED=true
export MATCHING_DISPATCH_ENABLED=false FULFILLMENT_DISPATCH_ENABLED=false AFTERCARE_DISPATCH_ENABLED=false FINANCE_DISPATCH_ENABLED=false
export PROCESSING_IMAGE=agat-processing:local PROCESSING_RUNNER_SCRIPT="$PWD/ops/processing/run-job.sh"
export PROCESSING_SECCOMP_PROFILE="$PWD/ops/processing/seccomp.json" PROCESSING_TIMEOUT_SECONDS=120
pnpm --filter @agat/api start > "$work_dir/api.log" 2>&1 & api_pid=$!
pnpm --filter @agat/web start > "$work_dir/web.log" 2>&1 & web_pid=$!
wait_url http://localhost:4000/api/v1/health/ready
wait_url http://localhost:3000

phase=stage11-browser-e2e
# Playwright's dependency installer runs apt-get update. The hosted runner also
# carries an unrelated Google Chrome source whose CDN metadata can be out of
# sync and fail with Hash Sum mismatch. Chromium comes from Playwright, so
# exclude that third-party source deterministically before resolving OS libs.
if [[ -f /etc/apt/sources.list.d/google-chrome.list ]]; then
  if [[ -w /etc/apt/sources.list.d ]]; then
    rm -f /etc/apt/sources.list.d/google-chrome.list
  else
    sudo rm -f /etc/apt/sources.list.d/google-chrome.list
  fi
fi
pnpm --filter @agat/web exec playwright install --with-deps chromium
set +e
STAGE11_PDF_FIXTURE="$PWD/$work_dir/synthetic.pdf" pnpm --filter @agat/web exec playwright test e2e/stage11.spec.ts 2>&1 | tee "$work_dir/browser-e2e.log"
browser_status="${PIPESTATUS[0]}"
set -e
if [[ "$browser_status" -ne 0 ]]; then
  summary="$(grep -E 'Error:|Timeout|expect\(|Expected:|Received:|stage11\.spec\.ts:|failed|passed' "$work_dir/browser-e2e.log" | tail -16 | sed -E 's/[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}/[id]/g; s/\+998[0-9]+/[phone]/g; s#(quarantine|objects|previews|print-ready)/[^ ]+#[object]/#g' | paste -sd ';' -)"
  summary="${summary//'%'/'%25'}"
  summary="${summary//$'\n'/'%0A'}"
  summary="${summary//$'\r'/'%0D'}"
  echo "::error title=Stage 11 browser E2E failure::${summary:-no-safe-summary}"
  exit "$browser_status"
fi
browser_e2e=passed

phase=privacy-cache-and-worker
headers="$(curl --fail --silent --dump-header - --output /dev/null http://localhost:4000/api/v1/catalog?locale=ru)"
grep -Eqi '^Cache-Control:.*no-store.*private' <<<"$headers"
metrics="$(curl --fail --silent http://localhost:4000/api/v1/metrics)"
if grep -Eqi 'draft_id|quote_id|catalog_id|user_id|order_id|file_id|object_key|signed|filename|phone|address|request_id|query' <<<"$metrics"; then
  echo 'Private or high-cardinality metric label found' >&2; exit 1
fi
if grep -Eqi 'quarantine/[a-f0-9]|objects/[a-f0-9]|previews/[a-f0-9]|print-ready/[a-f0-9]|X-Amz-Signature|\+998000000121' "$work_dir/api.log" "$work_dir/web.log"; then
  echo 'Sensitive customer-ordering value found in logs' >&2; exit 1
fi
for route in '/api/' '/order-drafts/' '/catalog' '/new-order' '/drafts/' '/notifications' '/orders/'; do grep -Fq "\"$route\"" apps/web/public/sw.js; done
audit_leaks="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc 'SELECT count(*) FROM "AuditEvent" WHERE metadata::text ~* $$(quarantine/|objects/|previews/|print-ready/|filename|signed.?url|\\+998|address)$$')"
test "$audit_leaks" = 0

phase=backup
kill "$web_pid" "$api_pid" >/dev/null 2>&1 || true
web_pid=""; api_pid=""
"${compose[@]}" stop processing-worker
backup_started="$(date +%s)"
"${compose[@]}" run --rm backup

phase=isolated-restore
restore_started="$(date +%s)"
"${compose[@]}" run --rm restore

phase=restore-integrity
"${compose[@]}" run --rm -T --entrypoint bash restore -seu <<'SCRIPT'
catalogs="$(psql -XAtqc 'SELECT count(*) FROM "PlatformCatalogVersion"')"
drafts="$(psql -XAtqc 'SELECT count(*) FROM "OrderDraft"')"
quotes="$(psql -XAtqc 'SELECT count(*) FROM "PriceQuote"')"
orders="$(psql -XAtqc 'SELECT count(*) FROM "Order" WHERE "orderDraftId" IS NOT NULL')"
events="$(psql -XAtqc 'SELECT count(*) FROM "CustomerOrderEvent"')"
[[ "$catalogs" -gt 0 && "$drafts" -gt 0 && "$quotes" -gt 0 && "$orders" -gt 0 && "$events" -gt 0 ]]
duplicates="$(psql -XAtqc 'SELECT count(*) FROM (SELECT "orderDraftId" FROM "Order" WHERE "orderDraftId" IS NOT NULL GROUP BY "orderDraftId" HAVING count(*) > 1) x')"
[[ "$duplicates" == 0 ]]
leaks="$(psql -XAtqc 'SELECT count(*) FROM "CustomerOrderEvent" WHERE "eventCode" !~ $re$^[A-Z_]{3,80}$$re$')"
[[ "$leaks" == 0 ]]
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
echo 'Stage 11 verification succeeded.'
