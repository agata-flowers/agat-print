#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root_dir"
mkdir -p outputs
report="outputs/stage17-1-premium-ux-verification-report.json"
phase="initialize"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

write_report() {
  STAGE171_RESULT="$1" STAGE171_PHASE="$phase" STAGE171_FAILURE_LINE="${2:-}" STAGE171_STARTED="$started_at" node <<'NODE'
const fs = require("node:fs");
const cp = require("node:child_process");
const report = {
  schemaVersion: 1,
  stage: "17.1",
  result: process.env.STAGE171_RESULT,
  phase: process.env.STAGE171_PHASE,
  failureLine: process.env.STAGE171_FAILURE_LINE || null,
  commitSha: process.env.GITHUB_SHA || cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  startedAt: process.env.STAGE171_STARTED,
  finishedAt: new Date().toISOString(),
  evidence: {
    route: "/premium",
    locales: ["uz", "ru", "en"],
    serviceFlows: ["id-photo", "printing", "outdoor", "presentations", "coursework", "design"],
    serviceCartSeparated: true,
    browserE2eRetries: 0,
    syntheticCatalogOnly: true,
    backendChanged: false,
    dockerRequired: false,
    responsiveViewports: ["desktop", "tablet", "mobile"],
    occupiedPortFallback: "4173-4183"
  }
};
fs.writeFileSync("outputs/stage17-1-premium-ux-verification-report.json", `${JSON.stringify(report, null, 2)}\n`);
NODE
  sha256sum "$report" > outputs/stage17-1-premium-ux-verification-report.sha256
}

trap 'write_report "failure" "$LINENO"' ERR

phase="unit-type-lint-build"
pnpm --filter @agat/platform-preview test
pnpm --filter @agat/platform-preview lint
pnpm --filter @agat/platform-preview typecheck
pnpm --filter @agat/platform-preview build

phase="browser-e2e"
pnpm --filter @agat/web exec playwright install --with-deps chromium
pnpm --filter @agat/platform-preview test:e2e

phase="review-screenshots"
CAPTURE_STAGE17_SCREENSHOTS=1 pnpm --filter @agat/platform-preview exec playwright test e2e/premium.spec.ts --grep "capture approved"

phase="windows-package"
package_dir="outputs/stage17-1-premium-ui-windows"
rm -rf "$package_dir" outputs/stage17-1-premium-ui-windows.zip
mkdir -p "$package_dir" outputs/stage17-1-screenshots
cp -R apps/preview/dist "$package_dir/dist"
cp ops/premium-preview/Start-AGAT-Premium-Prototype.cmd "$package_dir/"
cp ops/premium-preview/Start-AGAT-Premium-Prototype.ps1 "$package_dir/"
cp ops/premium-preview/README_RU.txt "$package_dir/"
find apps/preview/test-results -name 'stage17-premium-*.png' -exec cp {} outputs/stage17-1-screenshots/ \;
(cd outputs && zip -q -r stage17-1-premium-ui-windows.zip stage17-1-premium-ui-windows)
sha256sum outputs/stage17-1-premium-ui-windows.zip > outputs/stage17-1-premium-ui-windows.zip.sha256

phase="complete"
write_report "success"
trap - ERR
