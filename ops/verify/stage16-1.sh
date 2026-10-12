#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root_dir"
mkdir -p outputs
report="outputs/stage16-1-verification-report.json"
phase="initialize"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

write_report() {
  local result="$1"
  local failure_line="${2:-}"
  STAGE16_RESULT="$result" STAGE16_PHASE="$phase" STAGE16_FAILURE_LINE="$failure_line" STAGE16_STARTED="$started_at" node <<'NODE'
const fs = require("node:fs");
const report = {
  schemaVersion: 1,
  stage: "16.1",
  result: process.env.STAGE16_RESULT,
  phase: process.env.STAGE16_PHASE,
  failureLine: process.env.STAGE16_FAILURE_LINE || null,
  commitSha: process.env.GITHUB_SHA || require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  startedAt: process.env.STAGE16_STARTED,
  finishedAt: new Date().toISOString(),
  evidence: {
    locales: ["uz", "ru", "en"],
    surfaces: ["customer-web", "mobile-browser", "studio-browser"],
    customerSteps: ["home", "service", "upload", "settings", "preview", "basket", "checkout", "status"],
    syntheticOnly: true,
    productionMutations: false,
    browserE2eRetries: 0,
  },
};
fs.writeFileSync("outputs/stage16-1-verification-report.json", `${JSON.stringify(report, null, 2)}\n`);
NODE
  sha256sum "$report" > outputs/stage16-1-verification-report.sha256
}

on_error() {
  local line="$1"
  write_report "failure" "$line"
}
trap 'on_error "$LINENO"' ERR

phase="locale-and-shared-contract-tests"
pnpm --filter @agat/i18n test
pnpm --filter @agat/api-client test
pnpm --filter @agat/platform-preview test

phase="preview-build"
pnpm --filter @agat/platform-preview build
node ops/verify/stage16-1.mjs

phase="browser-e2e"
pnpm --filter @agat/web exec playwright install --with-deps chromium
pnpm --filter @agat/platform-preview test:e2e

phase="windows-preview-package"
package_dir="outputs/stage16-web-preview-windows"
rm -rf "$package_dir" outputs/stage16-web-preview-windows.zip
mkdir -p "$package_dir"
cp -R apps/preview/dist "$package_dir/dist"
cp ops/preview/Start-AGAT-Web-Preview.cmd "$package_dir/"
cp ops/preview/Start-AGAT-Web-Preview.ps1 "$package_dir/"
cp ops/preview/README_RU.txt "$package_dir/"
(cd outputs && zip -q -r stage16-web-preview-windows.zip stage16-web-preview-windows)
sha256sum outputs/stage16-web-preview-windows.zip > outputs/stage16-web-preview-windows.zip.sha256

phase="complete"
write_report "success"
trap - ERR
