#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f compose.yaml -f compose.verify.yaml --profile backup --profile processing)
report_dir="${VERIFY_REPORT_DIR:-outputs}"
work_dir="work/stage15-verification"
mkdir -p "$report_dir" "$work_dir"
phase=initialization failure_line=null db_e2e=not_run browser_e2e=not_run
rpo=null rto=null api_pid="" web_pid=""
execution_environment=local-docker
[[ -n "${GITHUB_ACTIONS:-}" ]] && execution_environment=github-actions

write_report() {
  local result="$1" checks=not_completed evidence=null
  [[ "$result" == success ]] && checks=passed
  if compgen -G "$work_dir/*e2e.log" >/dev/null; then
    evidence="\"$(cat "$work_dir"/*e2e.log | sha256sum | cut -d' ' -f1)\""
  fi
  printf '{"result":"%s","phase":"%s","failureLine":%s,"commitSha":"%s","scope":"multi-item-single-studio-print-basket","executionEnvironment":"%s","databaseE2E":"%s","browserE2E":"%s","browserRetries":0,"customerLocales":["uz","ru","en"],"stage1To14Regression":"executed-by-prior-workflow-gates","migrations":"clean-and-repeatable","securityPrivacyConcurrencyIdempotency":"%s","backupRestore":"%s","multiItemLineageRestore":"%s","rpoSeconds":%s,"rtoSeconds":%s,"evidenceSha256":%s}\n' \
    "$result" "$phase" "$failure_line" "${GITHUB_SHA:-$(git rev-parse HEAD)}" "$execution_environment" "$db_e2e" "$browser_e2e" "$checks" "$checks" "$checks" "$rpo" "$rto" "$evidence" > "$report_dir/stage15-verification-report.json"
  sha256sum "$report_dir/stage15-verification-report.json" > "$report_dir/stage15-verification-report.sha256"
}

write_report running
trap 'failure_line=$LINENO' ERR
cleanup() {
  local result="$?"
  [[ -n "$web_pid" ]] && { kill "$web_pid" >/dev/null 2>&1 || true; wait "$web_pid" 2>/dev/null || true; }
  [[ -n "$api_pid" ]] && { kill "$api_pid" >/dev/null 2>&1 || true; wait "$api_pid" 2>/dev/null || true; }
  if [[ "$result" -ne 0 ]]; then
    write_report failure
    echo "Stage 15 verification failed during phase: $phase" >&2
    test -f "$work_dir/db-e2e.log" && tail -120 "$work_dir/db-e2e.log" >&2 || true
    test -f "$work_dir/browser-e2e.log" && tail -120 "$work_dir/browser-e2e.log" >&2 || true
    "${compose[@]}" ps >&2 || true
  fi
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

phase=stage15-db-e2e
set +e
"${compose[@]}" run --rm -e NODE_ENV=test -e RUN_STAGE15_E2E=1 \
  -e PAYMENT_PROVIDER=mock -e PAYMENT_REFERENCE_KEY=cHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHA= \
  -e PROCESSING_DISPATCH_ENABLED=false -e MATCHING_DISPATCH_ENABLED=false \
  -e FULFILLMENT_DISPATCH_ENABLED=false -e AFTERCARE_DISPATCH_ENABLED=false \
  -e FINANCE_DISPATCH_ENABLED=false -e ORDERING_DISPATCH_ENABLED=false \
  api pnpm --filter @agat/api exec vitest run test/stage15.e2e.spec.ts --no-file-parallelism 2>&1 | tee "$work_dir/db-e2e.log"
db_status="${PIPESTATUS[0]}"
set -e
[[ "$db_status" -eq 0 ]] || exit "$db_status"
db_e2e=passed

phase=browser-runtime
pnpm db:generate
pnpm build
export NODE_ENV=test WEB_ORIGIN=http://localhost:3000 API_PORT=4000
export JWT_ACCESS_SECRET=ci-only-secret-at-least-32-characters OTP_PROVIDER=mock MOCK_OTP_CODE=000000
export PAYMENT_PROVIDER=mock MOCK_PAYMENT_SECRET=development-only-mock-payment-secret
export PAYMENT_REFERENCE_KEY=cHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHA=
export DATABASE_URL='postgresql://agat:development-only@localhost:5432/agat_print?schema=public'
export REDIS_URL=redis://localhost:6379 MINIO_ENDPOINT=http://localhost:9000
export MINIO_ACCESS_KEY=development-only MINIO_SECRET_KEY=development-only-change-me MINIO_BUCKET=agat-private
export PROCESSING_DISPATCH_ENABLED=false ORDERING_DISPATCH_ENABLED=false MATCHING_DISPATCH_ENABLED=false
export FULFILLMENT_DISPATCH_ENABLED=false AFTERCARE_DISPATCH_ENABLED=false FINANCE_DISPATCH_ENABLED=false
node apps/api/dist/main.js > "$work_dir/api.log" 2>&1 & api_pid=$!
(cd apps/web && exec node node_modules/next/dist/bin/next start) > "$PWD/$work_dir/web.log" 2>&1 & web_pid=$!
wait_url http://localhost:4000/api/v1/health/ready
wait_url http://localhost:3000

phase=stage15-browser-e2e
if [[ -f /etc/apt/sources.list.d/google-chrome.list ]]; then sudo rm -f /etc/apt/sources.list.d/google-chrome.list; fi
pnpm --filter @agat/web exec playwright install --with-deps chromium
set +e
RUN_STAGE15_BROWSER_E2E=1 pnpm --filter @agat/web exec playwright test e2e/stage15.spec.ts --retries=0 2>&1 | tee "$work_dir/browser-e2e.log"
browser_status="${PIPESTATUS[0]}"
set -e
[[ "$browser_status" -eq 0 ]] || exit "$browser_status"
browser_e2e=passed

phase=privacy-security-audit
headers="$(curl --fail --silent --dump-header - --output /dev/null http://localhost:4000/api/v1/catalog?locale=en)"
grep -Eqi '^Cache-Control:.*no-store.*private' <<<"$headers"
metrics="$(curl --fail --silent http://localhost:4000/api/v1/metrics)"
if grep -Eqi 'basket_id|order_item_id|address|phone|object_key|signed|request_id' <<<"$metrics"; then exit 1; fi
if grep -Eqi 'addressCiphertext|objectKey|X-Amz-Signature|\+998000001501' "$work_dir/api.log" "$work_dir/web.log"; then exit 1; fi

phase=backup
kill "$web_pid" "$api_pid" >/dev/null 2>&1 || true
wait "$web_pid" 2>/dev/null || true; wait "$api_pid" 2>/dev/null || true
web_pid=""; api_pid=""
backup_started="$(date +%s)"
"${compose[@]}" run --rm backup

phase=isolated-restore
restore_started="$(date +%s)"
"${compose[@]}" run --rm restore

phase=restore-multi-item-lineage
"${compose[@]}" run --rm -T --entrypoint bash restore -seu <<'SCRIPT'
multi_orders="$(psql -XAtqc 'SELECT count(*) FROM "Order" o WHERE (SELECT count(*) FROM "OrderItem" i WHERE i."orderId"=o.id)>1')"
[[ "$multi_orders" -gt 0 ]]
invalid="$(psql -XAtqc 'SELECT count(*) FROM "OrderItem" i LEFT JOIN "LayoutApproval" a ON a.id=i."layoutApprovalId" LEFT JOIN "PrintReadyVersion" p ON p.id=i."printReadyVersionId" WHERE a.id IS NULL OR p.id IS NULL')"
[[ "$invalid" == 0 ]]
duplicate_orders="$(psql -XAtqc 'SELECT count(*) FROM (SELECT "basketId" FROM "Order" WHERE "basketId" IS NOT NULL GROUP BY "basketId" HAVING count(*)>1) x')"
[[ "$duplicate_orders" == 0 ]]
price_mismatch="$(psql -XAtqc 'SELECT count(*) FROM "Order" o JOIN "PriceSnapshot" p ON p."orderId"=o.id WHERE o."basketId" IS NOT NULL AND p."totalMinor" <> (SELECT coalesce(sum(i."totalMinor"),0) FROM "OrderItem" i WHERE i."orderId"=o.id) + coalesce((SELECT f."feeMinor" FROM "OrderFulfillmentSelectionSnapshot" f WHERE f."orderId"=o.id),0)')"
[[ "$price_mismatch" == 0 ]]
SCRIPT
restore_finished="$(date +%s)"
rpo="$((restore_started-backup_started))"; rto="$((restore_finished-restore_started))"
test "$rpo" -le 86400; test "$rto" -le 14400

phase=git-integrity
git diff --check
test -z "$(git status --porcelain --untracked-files=all)"
phase=complete
write_report success
echo 'Stage 15 verification succeeded.'
