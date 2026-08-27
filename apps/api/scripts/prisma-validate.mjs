import { spawnSync } from "node:child_process";

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("pnpm executable path is unavailable");

const result = spawnSync(
  process.execPath,
  [pnpmCli, "exec", "prisma", "validate"],
  {
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://validation-only:validation-only@localhost:5432/validation_only",
    },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
