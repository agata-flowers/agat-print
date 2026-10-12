import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const required = [
  "APP_PLATFORM_STRATEGY.md",
  "docs/STAGE16_PROPOSAL.md",
  "docs/STAGE16_1_CONTRACT.md",
  "docs/api/openapi.yaml",
  "docs/api/openapi-stage16.1.sha256",
  "apps/preview/dist/index.html",
  "ops/preview/Start-AGAT-Web-Preview.cmd",
  "ops/preview/Start-AGAT-Web-Preview.ps1",
];
for (const relativePath of required) {
  if (!existsSync(join(root, relativePath))) {
    throw new Error(
      `Required Stage 16.1 deliverable is missing: ${relativePath}`,
    );
  }
}

const openApiDigest = createHash("sha256")
  .update(readFileSync(join(root, "docs/api/openapi.yaml")))
  .digest("hex");
const expectedOpenApiDigest = readFileSync(
  join(root, "docs/api/openapi-stage16.1.sha256"),
  "utf8",
)
  .trim()
  .split(/\s+/)[0];
if (openApiDigest !== expectedOpenApiDigest) {
  throw new Error(
    "OpenAPI drift detected; review compatibility and update the approved digest explicitly",
  );
}

const source = readFileSync(join(root, "apps/preview/src/App.tsx"), "utf8");
for (const forbidden of [
  /fetch\s*\(/,
  /XMLHttpRequest/,
  /\/api\/v1/,
  /BEGIN [A-Z ]*PRIVATE KEY/,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
]) {
  if (forbidden.test(source)) {
    throw new Error(`Unsafe preview fixture pattern detected: ${forbidden}`);
  }
}

const assetsDirectory = join(root, "apps/preview/dist/assets");
const assets = readdirSync(assetsDirectory).sort();
if (
  !assets.some((file) => file.endsWith(".js")) ||
  !assets.some((file) => file.endsWith(".css"))
) {
  throw new Error("Preview bundle must contain JavaScript and CSS assets");
}

const digest = createHash("sha256")
  .update(readFileSync(join(root, "apps/preview/dist/index.html")))
  .digest("hex");
process.stdout.write(
  JSON.stringify({ assets, indexSha256: digest, openApiSha256: openApiDigest }),
);
