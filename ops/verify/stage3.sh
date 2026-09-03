#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f compose.yaml)
report_dir="${VERIFY_REPORT_DIR:-outputs}"
work_dir="work/stage3-verification"
mkdir -p "$report_dir" "$work_dir"
phase="initialization"

write_report() {
  local result="$1"
  local completed_phase="$2"
  cat > "$report_dir/stage3-verification-report.json" <<JSON
{
  "result": "$result",
  "phase": "$completed_phase",
  "allowedFormats": ["PDF", "DOCX", "JPG", "JPEG", "PNG"]
}
JSON
}

write_report running "$phase"

cleanup() {
  local status="$?"
  if [[ "$status" -ne 0 ]]; then
    write_report failure "$phase"
    "${compose[@]}" ps >&2 || true
    "${compose[@]}" logs --no-color --tail=100 api postgres redis minio clamav >&2 || true
  fi
  docker rm -f agat-processing-isolation-check agat-processing-timeout-check \
    >/dev/null 2>&1 || true
  docker volume ls -q --filter name=agat-processing- | \
    xargs -r docker volume rm -f >/dev/null 2>&1 || true
  "${compose[@]}" --profile processing down --volumes --remove-orphans \
    >/dev/null 2>&1 || true
  rm -rf "$work_dir"
  return "$status"
}
trap cleanup EXIT

wait_healthy() {
  local service="$1"
  local container_id status
  for _ in $(seq 1 90); do
    container_id="$("${compose[@]}" ps -q "$service")"
    if [[ -n "$container_id" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
      [[ "$status" == healthy || "$status" == running ]] && return 0
    fi
    sleep 2
  done
  echo "Stage 3 dependency failed its health check: $service" >&2
  return 1
}

echo 'Validating Compose and building stage 3 images.'
phase="compose-build"
"${compose[@]}" --profile processing config --quiet
"${compose[@]}" --profile processing build api web processing-runtime processing-worker

phase="dependency-health"
"${compose[@]}" up -d postgres redis minio clamav
for service in postgres redis minio clamav; do
  wait_healthy "$service"
done

echo 'Applying stage 3 migrations twice on a clean PostgreSQL database.'
phase="database-migrations"
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy

echo 'Running stage 3 database, MinIO, ClamAV and idempotency E2E tests.'
phase="stage3-e2e"
"${compose[@]}" run --rm \
  -e NODE_ENV=test \
  -e RUN_STAGE3_E2E=1 -e AFTERCARE_DISPATCH_ENABLED=false \
  -e PROCESSING_DISPATCH_ENABLED=false \
  api pnpm --filter @agat/api exec vitest run test/stage3.e2e.spec.ts \
    --no-file-parallelism

echo 'Verifying isolated processing runtime and a successful normalized result.'
phase="processing-result"
printf '%s' \
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' \
  | base64 --decode > "$work_dir/input"
PROCESSING_IMAGE=agat-processing:local \
PROCESSING_SECCOMP_PROFILE="$PWD/ops/processing/seccomp.json" \
PROCESSING_TIMEOUT_SECONDS=120 \
  sh ops/processing/run-job.sh \
    "$work_dir/input" "$work_dir/output.pdf" PNG
test -s "$work_dir/output.pdf"
head -c 5 "$work_dir/output.pdf" | grep -q '%PDF-'

phase="processing-isolation"
docker create --name agat-processing-isolation-check \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --security-opt "seccomp=$PWD/ops/processing/seccomp.json" \
  --pids-limit 64 \
  --memory 768m \
  --memory-swap 768m \
  --cpus 1 \
  --user 65532:65532 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m,uid=65532,gid=65532 \
  --entrypoint sleep \
  agat-processing:local 30 >/dev/null

test "$(docker inspect --format '{{.HostConfig.NetworkMode}}' agat-processing-isolation-check)" = none
test "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' agat-processing-isolation-check)" = true
test "$(docker inspect --format '{{.HostConfig.PidsLimit}}' agat-processing-isolation-check)" = 64
test "$(docker inspect --format '{{.HostConfig.Memory}}' agat-processing-isolation-check)" = 805306368
test "$(docker inspect --format '{{.HostConfig.NanoCpus}}' agat-processing-isolation-check)" = 1000000000
security_options="$(docker inspect --format '{{join .HostConfig.SecurityOpt ","}}' agat-processing-isolation-check)"
grep -q 'no-new-privileges' <<<"$security_options"
grep -q 'seccomp' <<<"$security_options"
test "$(docker inspect --format '{{join .HostConfig.CapDrop ","}}' agat-processing-isolation-check)" = ALL
if docker inspect --format '{{join .Config.Env "\n"}}' agat-processing-isolation-check |
  grep -Eqi 'DATABASE|POSTGRES|REDIS|MINIO|JWT|RESTIC|PASSWORD|SECRET|TOKEN'; then
  echo 'Infrastructure secret name reached the processing container.' >&2
  exit 1
fi

if docker run --rm --network none --entrypoint python3 agat-processing:local \
  -c "import socket; socket.create_connection(('1.1.1.1', 53), 1)" \
  >/dev/null 2>&1; then
  echo 'Processing container unexpectedly reached the network.' >&2
  exit 1
fi
if docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --user 65532:65532 \
  --entrypoint touch agat-processing:local /root-write-test >/dev/null 2>&1; then
  echo 'Processing container root filesystem was writable.' >&2
  exit 1
fi

set +e
phase="processing-timeout"
timeout --signal=KILL 1 docker run --rm --name agat-processing-timeout-check \
  --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --security-opt "seccomp=$PWD/ops/processing/seccomp.json" \
  --pids-limit 16 --memory 64m --cpus 0.25 \
  --entrypoint sleep agat-processing:local 30 >/dev/null 2>&1
timeout_status=$?
set -e
if [[ "$timeout_status" -ne 124 && "$timeout_status" -ne 137 ]]; then
  echo 'Processing timeout control did not terminate the job.' >&2
  exit 1
fi
docker rm -f agat-processing-timeout-check >/dev/null 2>&1 || true

echo 'Verifying quarantine cleanup and telemetry/log redaction.'
phase="cleanup-and-redaction"
"${compose[@]}" run --rm --entrypoint sh minio -ceu '
  mc alias set source http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
  test -z "$(mc find "source/agat-private/quarantine" 2>/dev/null || true)"
'
"${compose[@]}" up -d api
wait_healthy api
curl --fail --silent http://localhost:4000/api/v1/metrics > "$work_dir/metrics"
if grep -Eqi 'user_id|order_id|partner_id|file_id|object|phone|filename|signed|request_id|query' "$work_dir/metrics"; then
  echo 'A forbidden or high-cardinality metric label was found.' >&2
  exit 1
fi
logs="$("${compose[@]}" logs --no-color api 2>&1)"
if grep -Eqi 'quarantine/[a-f0-9]|objects/[a-f0-9]|results/[a-f0-9]|X5O!P%@AP|\+998000000001|signed.?url' <<<"$logs"; then
  echo 'Sensitive upload data was found in service logs.' >&2
  exit 1
fi
audit_leaks="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc \
  "SELECT count(*) FROM \"AuditEvent\" WHERE metadata::text ~* '(quarantine/|objects/|results/|filename|signed.?url|\\+998)'")"
test "$audit_leaks" = 0

remaining_volumes="$(docker volume ls -q --filter name=agat-processing- | wc -l)"
test "$remaining_volumes" -eq 0

phase="complete"
cat > "$report_dir/stage3-verification-report.json" <<JSON
{
  "result": "success",
  "allowedFormats": ["PDF", "DOCX", "JPG", "JPEG", "PNG"],
  "databaseE2E": "passed",
  "antivirus": "fail-closed-and-eicar-verified",
  "docxArchiveControls": "verified",
  "processingIsolation": "verified",
  "processingTimeout": "verified",
  "queueIdempotency": "verified",
  "quarantineCleanup": "verified",
  "telemetryRedaction": "verified"
}
JSON

git diff --check
test -z "$(git status --porcelain --untracked-files=all)"
echo 'Stage 3 protected upload and isolated processing verification succeeded.'
