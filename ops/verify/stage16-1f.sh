#!/usr/bin/env bash
set -Eeuo pipefail

compose=(docker compose -f compose.yaml -f compose.verify.yaml --profile backup --profile processing)
report_dir="${VERIFY_REPORT_DIR:-outputs}"
work_dir="work/stage16-1f-verification"
report="$report_dir/stage16-1f-verification-report.json"
mkdir -p "$report_dir" "$work_dir"
phase=initialization failure_line=null browser_e2e=not_run migrations=not_run
backup_restore=not_run rpo=null rto=null

write_report() {
  local result="$1" checks=not_completed evidence=null execution_environment=local-docker
  [[ "$result" == success ]] && checks=passed
  [[ "${GITHUB_ACTIONS:-}" == true ]] && execution_environment=github-actions
  [[ -f "$work_dir/browser-e2e.log" ]] && evidence="\"$(sha256sum "$work_dir/browser-e2e.log" | cut -d' ' -f1)\""
  printf '{"schemaVersion":1,"stage":"16.1F","result":"%s","phase":"%s","failureLine":%s,"commitSha":"%s","scope":"functional-customer-studio-web-pilot","executionEnvironment":"%s","browserE2E":"%s","browserRetries":0,"locales":["uz","ru","en"],"migrations":"%s","pilotSeed":"%s","customerStudioJourney":"%s","securityPrivacyRBAC":"%s","stage1To15Regression":"executed-by-prior-workflow-gates","backupRestore":"%s","rpoSeconds":%s,"rtoSeconds":%s,"evidenceSha256":%s}\n' \
    "$result" "$phase" "$failure_line" "${GITHUB_SHA:-$(git rev-parse HEAD)}" "$execution_environment" "${browser_e2e}" "$migrations" "$checks" "$checks" "$checks" "$backup_restore" "$rpo" "$rto" "$evidence" > "$report"
  sha256sum "$report" > "$report_dir/stage16-1f-verification-report.sha256"
}

write_report running
trap 'failure_line=$LINENO' ERR
cleanup() {
  local result="$?"
  if [[ "$result" -ne 0 ]]; then
    write_report failure
    echo "Stage 16.1F verification failed during phase: $phase" >&2
    test -f "$work_dir/browser-e2e.log" && tail -120 "$work_dir/browser-e2e.log" >&2 || true
    "${compose[@]}" logs --no-color --tail=100 api web processing-worker >&2 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  return "$result"
}
trap cleanup EXIT

wait_healthy() {
  local service="$1" id status
  for _ in $(seq 1 120); do
    id="$("${compose[@]}" ps -q "$service")"
    if [[ -n "$id" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")"
      [[ "$status" == healthy || "$status" == running ]] && return 0
    fi
    sleep 2
  done
  return 1
}

export NODE_ENV=development WEB_ORIGIN=http://localhost:3000
export OTP_PROVIDER=mock MOCK_OTP_CODE=000000 PAYMENT_PROVIDER=mock
export FISCAL_PROVIDER=mock PAYOUT_PROVIDER=mock DELIVERY_PROVIDER=internal
export STAGE13_FULFILLMENT_ENABLED=true MINIO_PUBLIC_ENDPOINT=http://localhost:9000

phase=compose-build-health
"${compose[@]}" config --quiet
"${compose[@]}" build api web processing-runtime processing-worker backup restore
"${compose[@]}" up -d postgres redis minio clamav backup-minio postgres-restore minio-restore
for service in postgres redis minio clamav backup-minio postgres-restore minio-restore; do
  wait_healthy "$service"
done

phase=clean-repeatable-migrations
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy
migrations=passed

phase=pilot-seed
"${compose[@]}" run --rm api node apps/api/scripts/pilot-seed.mjs
"${compose[@]}" run --rm api node apps/api/scripts/pilot-seed.mjs

phase=synthetic-browser-input
docker run --rm -i --user 0:0 --entrypoint python3 -v "$PWD/$work_dir:/fixtures" agat-processing:local - <<'PY'
from PIL import Image
Image.new('RGB', (2480, 3508), 'white').save('/fixtures/synthetic.pdf', 'PDF', resolution=300)
PY

phase=browser-runtime
"${compose[@]}" up -d api web processing-worker
for service in api web processing-worker; do wait_healthy "$service"; done

phase=stage16-1f-browser-e2e
if [[ -f /etc/apt/sources.list.d/google-chrome.list ]]; then
  if [[ -w /etc/apt/sources.list.d ]]; then
    rm -f /etc/apt/sources.list.d/google-chrome.list
  else
    sudo rm -f /etc/apt/sources.list.d/google-chrome.list
  fi
fi
pnpm --filter @agat/web exec playwright install --with-deps chromium
set +e
RUN_STAGE16_1F_BROWSER_E2E=1 STAGE16_1F_PDF_FIXTURE="$PWD/$work_dir/synthetic.pdf" \
  pnpm --filter @agat/web exec playwright test e2e/stage16-1f.spec.ts --retries=0 2>&1 | tee "$work_dir/browser-e2e.log"
browser_status="${PIPESTATUS[0]}"
set -e
[[ "$browser_status" -eq 0 ]] || exit "$browser_status"
browser_e2e=passed

phase=security-privacy-cache
headers="$(curl --fail --silent --dump-header - --output /dev/null http://localhost:4000/api/v1/catalog?locale=en)"
grep -Eqi '^Cache-Control:.*no-store.*private' <<<"$headers"
metrics="$(curl --fail --silent http://localhost:4000/api/v1/metrics)"
if grep -Eqi 'user_id|order_id|file_id|object_key|signed|filename|phone|address|request_id|query' <<<"$metrics"; then
  echo 'Private or high-cardinality metric label found' >&2
  exit 1
fi
"${compose[@]}" logs --no-color api web processing-worker > "$work_dir/runtime.log"
if grep -Eqi 'X-Amz-Signature|quarantine/|objects/|previews/|print-ready/|\+99800001610[1-3]' "$work_dir/runtime.log"; then
  echo 'Sensitive pilot value found in runtime logs' >&2
  exit 1
fi

phase=backup
backup_started="$(date +%s)"
"${compose[@]}" run --rm backup

phase=isolated-restore
restore_started="$(date +%s)"
"${compose[@]}" run --rm restore
"${compose[@]}" run --rm -T --entrypoint bash restore -seu <<'SCRIPT'
pilot_partner="$(psql -XAtqc "SELECT count(*) FROM \"Partner\" WHERE \"displayName\"='AGAT PRINT Pilot Studio' AND status='ACTIVE'")"
[[ "$pilot_partner" == 1 ]]
completed="$(psql -XAtqc "SELECT count(*) FROM \"Order\" WHERE status='COMPLETED'")"
[[ "$completed" -gt 0 ]]
broken_price="$(psql -XAtqc 'SELECT count(*) FROM "Order" o LEFT JOIN "PriceSnapshot" p ON p."orderId"=o.id WHERE p.id IS NULL')"
[[ "$broken_price" == 0 ]]
broken_payment="$(psql -XAtqc 'SELECT count(*) FROM "Payment" p LEFT JOIN "Order" o ON o.id=p."orderId" WHERE o.id IS NULL')"
[[ "$broken_payment" == 0 ]]
SCRIPT
restore_finished="$(date +%s)"
rpo="$((restore_started-backup_started))"
rto="$((restore_finished-restore_started))"
test "$rpo" -le 86400
test "$rto" -le 14400
backup_restore=passed

phase=windows-artifact
git archive --format=zip --output "$report_dir/stage16-functional-web-windows.zip" HEAD
sha256sum "$report_dir/stage16-functional-web-windows.zip" > "$report_dir/stage16-functional-web-windows.zip.sha256"

phase=complete
write_report success
trap - ERR
echo 'Stage 16.1F verification succeeded.'
