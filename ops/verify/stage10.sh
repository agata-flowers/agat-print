#!/usr/bin/env bash
set -euo pipefail
compose=(docker compose -f compose.yaml -f compose.verify.yaml --profile backup)
report_dir="${VERIFY_REPORT_DIR:-outputs}"
mkdir -p "$report_dir"
phase=initialization
rpo=null
rto=null
db_e2e=not_run
execution_environment=local-docker
[[ -n "${GITHUB_ACTIONS:-}" ]] && execution_environment=github-actions
write_report() {
  local checks=not_completed
  [[ "$1" == success ]] && checks=passed
  printf '{"result":"%s","phase":"%s","rpoSeconds":%s,"rtoSeconds":%s,"scope":"partner-marketplace-production-network","executionEnvironment":"%s","databaseE2E":"%s","stage1To9Regression":"executed-by-prior-workflow-gates","requiredChecks":"%s","externalGeoProviders":"credentials-and-contracts-required"}\n' "$1" "$phase" "$rpo" "$rto" "$execution_environment" "$db_e2e" "$checks" > "$report_dir/stage10-verification-report.json"
}
write_report running
cleanup() {
  local result="$?"
  if [[ "$result" -ne 0 ]]; then
    write_report failure
    echo "Stage 10 verification failed during phase: $phase" >&2
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

phase=stage10-db-e2e
"${compose[@]}" run --rm -e NODE_ENV=test -e RUN_STAGE10_E2E=1 \
  -e PROCESSING_DISPATCH_ENABLED=false -e MATCHING_DISPATCH_ENABLED=false \
  -e FULFILLMENT_DISPATCH_ENABLED=false -e AFTERCARE_DISPATCH_ENABLED=false \
  -e FINANCE_DISPATCH_ENABLED=false \
  api pnpm --filter @agat/api exec vitest run test/stage10.e2e.spec.ts --no-file-parallelism
db_e2e=passed

phase=network-policy-and-worker
"${compose[@]}" run --rm -e NODE_ENV=test api pnpm --filter @agat/api exec vitest run src/matching/network-policy.spec.ts
"${compose[@]}" up -d api
wait_healthy api
for _ in $(seq 1 30); do
  queue_keys="$("${compose[@]}" exec -T redis redis-cli --scan --pattern 'bull:partner-matching:*' | wc -l)"
  [[ "$queue_keys" -gt 0 ]] && break
  sleep 1
done
test "$queue_keys" -gt 0

phase=privacy-rbac-integrity
headers="$(curl --fail --silent --dump-header - --output /dev/null http://localhost:4000/api/v1/health/ready)"
grep -Eqi '^Cache-Control:.*no-store.*private' <<<"$headers"
metrics="$(curl --fail --silent http://localhost:4000/api/v1/metrics)"
if grep -Eqi 'partner_id|branch_id|offer_id|order_id|latitude|longitude|contact|phone|address|object_key|signed|request_id' <<<"$metrics"; then
  echo 'Private or high-cardinality metric label found' >&2; exit 1
fi
logs="$("${compose[@]}" logs --no-color api 2>&1)"
if grep -Eqi 'operationalContact|Ciphertext|AuthTag|\+998000000|objectKey|X-Amz-Signature|completionPin|addressCiphertext' <<<"$logs"; then
  echo 'Sensitive partner-network value found in API logs' >&2; exit 1
fi

phase=backup-network-records
"${compose[@]}" stop api
backup_started="$(date +%s)"
"${compose[@]}" run --rm backup

phase=isolated-restore
restore_started="$(date +%s)"
"${compose[@]}" run --rm restore

phase=restore-network-integrity
"${compose[@]}" run --rm -T --entrypoint bash restore -seu <<'SCRIPT'
evaluations="$(psql -XAtqc 'SELECT count(*) FROM "MatchingCandidateEvaluation"')"
reservations="$(psql -XAtqc 'SELECT count(*) FROM "OfferCapacityReservation"')"
versions="$(psql -XAtqc 'SELECT (SELECT count(*) FROM "BranchOperationalVersion") + (SELECT count(*) FROM "BranchCatalogVersion") + (SELECT count(*) FROM "BranchCapacityVersion")')"
[[ "$evaluations" -gt 0 && "$reservations" -gt 0 && "$versions" -gt 0 ]]
duplicates="$(psql -XAtqc 'SELECT count(*) FROM (SELECT "offerId" FROM "OfferCapacityReservation" GROUP BY "offerId" HAVING count(*) > 1) x')"
[[ "$duplicates" == 0 ]]
over_capacity="$(psql -XAtqc 'SELECT count(*) FROM "BranchCapacityVersion" c WHERE c.status = $$ACTIVE$$ AND ((SELECT count(*) FROM "PartnerAssignment" a WHERE a."branchId" = c."branchId" AND a.active) + (SELECT count(*) FROM "OfferCapacityReservation" r WHERE r."branchId" = c."branchId" AND r.status = $$HELD$$ AND r."expiresAt" > now())) > c."maxConcurrentOrders"')"
[[ "$over_capacity" == 0 ]]
plaintext="$(psql -XAtqc 'SELECT count(*) FROM "Partner" WHERE "operationalContactCiphertext" LIKE $$%synthetic-operations-contact%$$')"
[[ "$plaintext" == 0 ]]
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
echo 'Stage 10 verification succeeded.'
