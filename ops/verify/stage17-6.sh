#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root_dir"
mkdir -p outputs
report="outputs/stage17-6-internal-marketplace-verification-report.json"
phase="initialize"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

write_report() {
  STAGE176_RESULT="$1" STAGE176_PHASE="$phase" STAGE176_FAILURE_LINE="${2:-}" STAGE176_STARTED="$started_at" node <<'NODE'
const fs = require("node:fs");
const cp = require("node:child_process");
const report = {
  schemaVersion: 1,
  stage: "17.6",
  result: process.env.STAGE176_RESULT,
  phase: process.env.STAGE176_PHASE,
  failureLine: process.env.STAGE176_FAILURE_LINE || null,
  commitSha: process.env.GITHUB_SHA || cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  startedAt: process.env.STAGE176_STARTED,
  finishedAt: new Date().toISOString(),
  evidence: {
    routeRoot: "/marketplace",
    locales: ["uz", "ru", "en"],
    desktopWidths: [1366, 1440, 1920],
    pages: ["catalog", "product", "cart", "checkout", "service", "assignment", "account", "store", "seller"],
    catalogFilters: ["query-suggestions", "category", "subcategory", "price", "rating", "availability", "sort"],
    sellerSpecificListings: true,
    productGalleryVariantsReviewsRecommendations: true,
    physicalAndServiceCheckoutSeparated: true,
    assignmentSimulation: ["eligibility", "ranking", "decline", "timeout", "next-candidate", "acceptance", "unavailable", "duplicate-protection"],
    accountOrderDetailsAndRepeat: true,
    sellerOnboardingProductsOrdersSettings: true,
    browserE2eRetries: 0,
    syntheticDataOnly: true,
    backendChanged: false,
    apiChanged: false,
    databaseChanged: false,
    dockerRequired: false,
    windowsLoopbackOnly: true,
    occupiedPortFallback: "4173-4183"
  }
};
fs.writeFileSync("outputs/stage17-6-internal-marketplace-verification-report.json", `${JSON.stringify(report, null, 2)}\n`);
NODE
  sha256sum "$report" > outputs/stage17-6-internal-marketplace-verification-report.sha256
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

phase="internal-page-screenshots"
CAPTURE_STAGE176_SCREENSHOTS=1 pnpm --filter @agat/platform-preview exec playwright test e2e/stage17-6.spec.ts --grep "capture Stage 17.6"

phase="windows-package"
package_dir="outputs/stage17-6-internal-marketplace-windows"
rm -rf "$package_dir" outputs/stage17-6-internal-marketplace-windows.zip outputs/stage17-6-screenshots
mkdir -p "$package_dir" outputs/stage17-6-screenshots
cp -R apps/preview/dist "$package_dir/dist"
cp ops/marketplace-preview/Start-AGAT-Marketplace.cmd "$package_dir/"
cp ops/marketplace-preview/Start-AGAT-Marketplace.ps1 "$package_dir/"
cp ops/marketplace-preview/README_STAGE17_6_RU.txt "$package_dir/README_RU.txt"
find apps/preview/test-results -name 'stage17-6-*.png' -exec cp {} outputs/stage17-6-screenshots/ \;
grep -q 'IPAddress]::Loopback' "$package_dir/Start-AGAT-Marketplace.ps1"
grep -Fq 'foreach ($candidatePort in $preferredPort..($preferredPort + 10))' "$package_dir/Start-AGAT-Marketplace.ps1"
grep -q "connect-src 'none'" "$package_dir/Start-AGAT-Marketplace.ps1"
(cd outputs && zip -q -r stage17-6-internal-marketplace-windows.zip stage17-6-internal-marketplace-windows)
sha256sum outputs/stage17-6-internal-marketplace-windows.zip > outputs/stage17-6-internal-marketplace-windows.zip.sha256

phase="complete"
write_report "success"
trap - ERR
