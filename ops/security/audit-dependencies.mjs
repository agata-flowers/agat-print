import { spawnSync } from "node:child_process";

const auditArguments = ["audit", "--json", "--audit-level=low"];
const pnpmEntrypoint = process.env.npm_execpath;
const result = spawnSync(
  pnpmEntrypoint ? process.execPath : "pnpm",
  pnpmEntrypoint ? [pnpmEntrypoint, ...auditArguments] : auditArguments,
  {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: !pnpmEntrypoint && process.platform === "win32",
  },
);

if (result.error) throw result.error;

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.stderr.write(result.stderr || result.stdout);
  throw new Error("dependency audit did not return valid JSON");
}

const acceptedAdvisories = new Map([
  [
    "GHSA-vfj7-8cjw-p6xm",
    {
      module: "braces",
      severity: "high",
      reason:
        "No patched release exists. The dependency is restricted to static lint glob matching and receives only repository-controlled patterns.",
      allowedPathPrefixes: [
        ".>@next/eslint-plugin-next>",
        ".>typescript-eslint>",
      ],
    },
  ],
]);

const advisories = Object.values(report.advisories ?? {});
const blocking = [];
const accepted = [];

for (const advisory of advisories) {
  if (!new Set(["critical", "high"]).has(advisory.severity)) continue;
  const exception = acceptedAdvisories.get(advisory.github_advisory_id);
  const paths = advisory.findings.flatMap((finding) => finding.paths);
  const isBoundedException =
    exception !== undefined &&
    advisory.module_name === exception.module &&
    advisory.severity === exception.severity &&
    advisory.findings.every((finding) => finding.dev === true) &&
    paths.length > 0 &&
    paths.every((path) =>
      exception.allowedPathPrefixes.some((prefix) => path.startsWith(prefix)),
    );

  if (isBoundedException) {
    accepted.push({
      advisory: advisory.github_advisory_id,
      module: advisory.module_name,
      reason: exception.reason,
    });
  } else {
    blocking.push({
      advisory: advisory.github_advisory_id,
      module: advisory.module_name,
      severity: advisory.severity,
    });
  }
}

for (const item of accepted) {
  process.stdout.write(
    `accepted bounded advisory ${item.advisory} (${item.module}): ${item.reason}\n`,
  );
}

if (blocking.length > 0) {
  process.stderr.write(
    `blocking dependency advisories: ${JSON.stringify(blocking)}\n`,
  );
  process.exit(1);
}

const counts = report.metadata?.vulnerabilities ?? {};
process.stdout.write(
  `dependency audit passed: 0 applicable critical/high; totals=${JSON.stringify(counts)}\n`,
);
