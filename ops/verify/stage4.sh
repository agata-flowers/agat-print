#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f compose.yaml)
report_dir="${VERIFY_REPORT_DIR:-outputs}"
work_dir="work/stage4-verification"
mkdir -p "$report_dir" "$work_dir"
phase="initialization"

write_report() {
  local result="$1"
  cat > "$report_dir/stage4-verification-report.json" <<JSON
{
  "result": "$result",
  "phase": "$phase",
  "scope": "preflight-preview-manual-review-layout-approval"
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
  docker volume ls -q --filter name=agat-processing- | xargs -r docker volume rm -f >/dev/null 2>&1 || true
  "${compose[@]}" --profile processing down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work_dir"
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
  echo "Stage 4 dependency failed its health check: $service" >&2
  return 1
}

phase="compose-build"
"${compose[@]}" --profile processing config --quiet
"${compose[@]}" --profile processing build api web processing-runtime processing-worker

phase="dependency-health"
"${compose[@]}" up -d postgres redis minio clamav
for service in postgres redis minio clamav; do wait_healthy "$service"; done

phase="database-migrations"
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy
"${compose[@]}" run --rm api pnpm --filter @agat/api exec prisma migrate deploy

phase="synthetic-inputs"
docker run --rm -i --user 0:0 --entrypoint python3 \
  -v "$PWD/$work_dir:/fixtures" agat-processing:local - <<'PY'
from pathlib import Path
from PIL import Image
import zipfile

root = Path('/fixtures')
image = Image.new('RGB', (1200, 1600), 'white')
image.save(root / 'synthetic.pdf', 'PDF', resolution=300)
image.save(root / 'synthetic.png', 'PNG')
image.save(root / 'synthetic.jpg', 'JPEG', quality=90)

content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>'''
rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''
document = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic stage four document</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'''
with zipfile.ZipFile(root / 'synthetic.docx', 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('[Content_Types].xml', content_types)
    archive.writestr('_rels/.rels', rels)
    archive.writestr('word/document.xml', document)
with zipfile.ZipFile(root / 'invalid.docx', 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('[Content_Types].xml', '<Types/>')
    archive.writestr('word/document.xml', '<not-xml')

(root / 'corrupt.pdf').write_bytes(b'%PDF-corrupt')

# A structurally complete PDF with an encryption dictionary. Poppler must reject
# it without a password; the application maps that failure to a quality state.
objects = [
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>',
    b'<< /Length 0 >>\nstream\n\nendstream',
    b'<< /Filter /Standard /V 1 /R 2 /O <0000000000000000000000000000000000000000000000000000000000000000> /U <0000000000000000000000000000000000000000000000000000000000000000> /P -4 >>',
]
pdf = bytearray(b'%PDF-1.4\n')
offsets = [0]
for index, obj in enumerate(objects, 1):
    offsets.append(len(pdf)); pdf.extend(f'{index} 0 obj\n'.encode() + obj + b'\nendobj\n')
xref = len(pdf)
pdf.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode())
for offset in offsets[1:]: pdf.extend(f'{offset:010d} 00000 n \n'.encode())
pdf.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R /Encrypt 5 0 R /ID [<00112233445566778899AABBCCDDEEFF><00112233445566778899AABBCCDDEEFF>] >>\nstartxref\n{xref}\n%%EOF\n'.encode())
(root / 'encrypted.pdf').write_bytes(pdf)
PY

phase="runtime-formats"
for pair in "PDF:pdf" "DOCX:docx" "JPEG:jpg" "PNG:png"; do
  kind="${pair%%:*}"; extension="${pair##*:}"
  PROCESSING_IMAGE=agat-processing:local \
  PROCESSING_SECCOMP_PROFILE="$PWD/ops/processing/seccomp.json" \
  PROCESSING_TIMEOUT_SECONDS=120 \
  PROCESSING_TARGET_WIDTH_MM=100 PROCESSING_TARGET_HEIGHT_MM=150 \
    sh ops/processing/run-job.sh "$work_dir/synthetic.$extension" \
      "$work_dir/$kind.pdf" "$kind" PREFLIGHT
  test -s "$work_dir/$kind.pdf"
  grep -q '"operation": "PREFLIGHT"' "$work_dir/$kind.pdf.json"
  grep -q '"printSuitable": true' "$work_dir/$kind.pdf.json"
done

phase="runtime-negative-files"
for pair in "PDF:corrupt.pdf" "PDF:encrypted.pdf" "DOCX:invalid.docx"; do
  kind="${pair%%:*}"; input="${pair##*:}"
  if PROCESSING_IMAGE=agat-processing:local \
    PROCESSING_SECCOMP_PROFILE="$PWD/ops/processing/seccomp.json" \
    PROCESSING_TIMEOUT_SECONDS=120 \
      sh ops/processing/run-job.sh "$work_dir/$input" "$work_dir/rejected.pdf" "$kind" PREFLIGHT; then
    echo "Invalid or protected input unexpectedly passed preflight." >&2
    exit 1
  fi
done

phase="stage4-e2e"
"${compose[@]}" run --rm \
  -e NODE_ENV=test \
  -e RUN_STAGE4_E2E=1 -e AFTERCARE_DISPATCH_ENABLED=false \
  -e PROCESSING_DISPATCH_ENABLED=false \
  api pnpm --filter @agat/api exec vitest run test/stage4.e2e.spec.ts --no-file-parallelism

phase="telemetry-and-cache"
"${compose[@]}" up -d api
wait_healthy api
curl --fail --silent http://localhost:4000/api/v1/metrics > "$work_dir/metrics"
if grep -Eqi 'user_id|layout_id|file_id|object|phone|filename|signed|request_id|query' "$work_dir/metrics"; then
  echo 'A forbidden or high-cardinality metric label was found.' >&2
  exit 1
fi
logs="$("${compose[@]}" logs --no-color api 2>&1)"
if grep -Eqi 'previews/[a-f0-9]|print-ready/[a-f0-9]|objects/[a-f0-9]|X-Amz-Signature|\+99800000004' <<<"$logs"; then
  echo 'Sensitive layout data was found in service logs.' >&2
  exit 1
fi
audit_leaks="$("${compose[@]}" exec -T postgres psql -U agat -d agat_print -Atqc \
  "SELECT count(*) FROM \"AuditEvent\" WHERE metadata::text ~* '(previews/|print-ready/|objects/|filename|signed.?url|\\+998)'")"
test "$audit_leaks" = 0
grep -q '"/layouts/"' apps/web/public/sw.js

phase="complete"
cat > "$report_dir/stage4-verification-report.json" <<JSON
{
  "result": "success",
  "formats": ["PDF", "DOCX", "JPEG", "PNG"],
  "runtimePreflight": "passed",
  "corruptEncryptedAndConversionFailures": "passed",
  "immutableIdempotentArtifacts": "passed",
  "manualReviewAndRbac": "passed",
  "approvalRaceAndStaleness": "passed",
  "cacheAndTelemetryPolicy": "passed"
}
JSON

git diff --check
test -z "$(git status --porcelain --untracked-files=all)"
echo 'Stage 4 preflight, preview and approval verification succeeded.'
