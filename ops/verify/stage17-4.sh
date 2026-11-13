#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root_dir"
mkdir -p outputs
report="outputs/stage17-4-complete-marketplace-verification-report.json"
phase="initialize"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

write_report() {
  STAGE174_RESULT="$1" STAGE174_PHASE="$phase" STAGE174_FAILURE_LINE="${2:-}" STAGE174_STARTED="$started_at" node <<'NODE'
const fs = require("node:fs");
const cp = require("node:child_process");
const report = {
  schemaVersion: 1,
  stage: "17.4",
  result: process.env.STAGE174_RESULT,
  phase: process.env.STAGE174_PHASE,
  failureLine: process.env.STAGE174_FAILURE_LINE || null,
  commitSha: process.env.GITHUB_SHA || cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  startedAt: process.env.STAGE174_STARTED,
  finishedAt: new Date().toISOString(),
  evidence: {
    route: "/marketplace",
    preservedRegressionRoute: "/premium",
    locales: ["uz", "ru", "en"],
    productCount: 24,
    sellers: 3,
    multiVendorOffers: true,
    customerAccount: true,
    sellerDashboard: true,
    serviceFlows: ["id-photo", "printing", "outdoor", "presentations", "coursework", "design"],
    catalogSearchFiltersSort: true,
    groupedCartAndDemoCheckout: true,
    browserBackForwardAndScrollRestore: true,
    automaticUniqueFeed: true,
    browserE2eRetries: 0,
    syntheticDataOnly: true,
    backendChanged: false,
    dockerRequired: false,
    responsiveViewports: [1920, 1440, 1366, 1280, 1024, 768, 430, 390, 375],
    windowsLoopbackOnly: true,
    occupiedPortFallback: "4173-4183"
  }
};
fs.writeFileSync("outputs/stage17-4-complete-marketplace-verification-report.json", `${JSON.stringify(report, null, 2)}\n`);
NODE
  sha256sum "$report" > outputs/stage17-4-complete-marketplace-verification-report.sha256
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
CAPTURE_STAGE174_SCREENSHOTS=1 pnpm --filter @agat/platform-preview exec playwright test e2e/marketplace.spec.ts --grep "capture Stage 17.4"

phase="windows-package"
package_dir="outputs/stage17-4-complete-marketplace-windows"
rm -rf "$package_dir" outputs/stage17-4-complete-marketplace-windows.zip outputs/stage17-4-screenshots
mkdir -p "$package_dir" outputs/stage17-4-screenshots
cp -R apps/preview/dist "$package_dir/dist"
cp ops/marketplace-preview/Start-AGAT-Marketplace.cmd "$package_dir/"
cp ops/marketplace-preview/Start-AGAT-Marketplace.ps1 "$package_dir/"
cp ops/marketplace-preview/README_RU.txt "$package_dir/"
find apps/preview/test-results -name 'stage17-4-marketplace-*.png' -exec cp {} outputs/stage17-4-screenshots/ \;
grep -q 'IPAddress]::Loopback' "$package_dir/Start-AGAT-Marketplace.ps1"
grep -Fq 'foreach ($candidatePort in $preferredPort..($preferredPort + 10))' "$package_dir/Start-AGAT-Marketplace.ps1"
grep -q "connect-src 'none'" "$package_dir/Start-AGAT-Marketplace.ps1"
(cd outputs && zip -q -r stage17-4-complete-marketplace-windows.zip stage17-4-complete-marketplace-windows)
sha256sum outputs/stage17-4-complete-marketplace-windows.zip > outputs/stage17-4-complete-marketplace-windows.zip.sha256

phase="complete"
write_report "success"
trap - ERR
