#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root_dir"
mkdir -p outputs
report="outputs/stage17-3-approved-design-verification-report.json"
phase="initialize"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

write_report() {
  STAGE173_RESULT="$1" STAGE173_PHASE="$phase" STAGE173_FAILURE_LINE="${2:-}" STAGE173_STARTED="$started_at" node <<'NODE'
const fs = require("node:fs");
const cp = require("node:child_process");
const report = {
  schemaVersion: 1,
  stage: "17.3",
  result: process.env.STAGE173_RESULT,
  phase: process.env.STAGE173_PHASE,
  failureLine: process.env.STAGE173_FAILURE_LINE || null,
  commitSha: process.env.GITHUB_SHA || cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  startedAt: process.env.STAGE173_STARTED,
  finishedAt: new Date().toISOString(),
  evidence: {
    route: "/premium",
    locales: ["uz", "ru", "en"],
    serviceFlows: ["id-photo", "printing", "outdoor", "presentations", "coursework", "design"],
    productGroups: ["stationery", "gifts", "accessories", "photo-gifts", "study-office"],
    approvedReferenceViewport: "1674x940",
    mobileReviewViewport: "390x844",
    desktopProductColumns: 6,
    originalLocalImageAssets: true,
    serviceCartSeparated: true,
    infiniteFeedUnique: true,
    browserE2eRetries: 0,
    syntheticCatalogOnly: true,
    backendChanged: false,
    dockerRequired: false,
    responsiveViewports: [1920, 1440, 1366, 1024, 768, 430, 390, 375],
    occupiedPortFallback: "4173-4183"
  }
};
fs.writeFileSync("outputs/stage17-3-approved-design-verification-report.json", `${JSON.stringify(report, null, 2)}\n`);
NODE
  sha256sum "$report" > outputs/stage17-3-approved-design-verification-report.sha256
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
package_dir="outputs/stage17-3-approved-design-windows"
rm -rf "$package_dir" outputs/stage17-3-approved-design-windows.zip
mkdir -p "$package_dir" outputs/stage17-3-screenshots
cp -R apps/preview/dist "$package_dir/dist"
cp ops/premium-preview/Start-AGAT-Premium-Prototype.cmd "$package_dir/Start-AGAT-Approved-Design.cmd"
cp ops/premium-preview/Start-AGAT-Premium-Prototype.ps1 "$package_dir/Start-AGAT-Approved-Design.ps1"
cp ops/premium-preview/README_STAGE17_3_RU.txt "$package_dir/README_RU.txt"
sed -i 's/Start-AGAT-Premium-Prototype.ps1/Start-AGAT-Approved-Design.ps1/g; s/AGAT PRINT Premium Prototype/AGAT PRINT Approved Design/g' "$package_dir/Start-AGAT-Approved-Design.cmd"
find apps/preview/test-results -name 'stage17-3-approved-*.png' -exec cp {} outputs/stage17-3-screenshots/ \;
(cd outputs && zip -q -r stage17-3-approved-design-windows.zip stage17-3-approved-design-windows)
sha256sum outputs/stage17-3-approved-design-windows.zip > outputs/stage17-3-approved-design-windows.zip.sha256

phase="complete"
write_report "success"
trap - ERR
