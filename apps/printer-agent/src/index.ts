import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { acceptPdfIntoSpool } from "./spool.js";

interface ClaimedJob {
  jobId: string;
  documentUrl: string;
}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const apiOrigin = required("AGAT_API_ORIGIN").replace(/\/$/, "");
const agentId = required("PRINTER_AGENT_ID");
const agentToken = required("PRINTER_AGENT_TOKEN");
const spoolDirectory = resolve(required("PRINTER_SPOOL_DIRECTORY"));
const pollMs = Number(process.env.PRINTER_AGENT_POLL_MS ?? 2_000);
const maxBytes = Number(process.env.PRINTER_AGENT_MAX_BYTES ?? 26_214_400);

if (
  !Number.isInteger(pollMs) ||
  pollMs < 500 ||
  !Number.isInteger(maxBytes) ||
  maxBytes < 1
)
  throw new Error("Invalid printer-agent numeric configuration");

const headers = (key: string) => ({
  Authorization: `Bearer ${agentToken}`,
  "X-Printer-Agent-Id": agentId,
  "Idempotency-Key": key,
  "Content-Type": "application/json",
});

const command = async (path: string, key: string, body?: unknown) => {
  const response = await fetch(`${apiOrigin}/api/v1${path}`, {
    method: "POST",
    headers: headers(key),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok)
    throw new Error(
      `Printer-agent API rejected operation (${response.status})`,
    );
  return response.json() as Promise<unknown>;
};

const acceptIntoSpool = async (job: ClaimedJob): Promise<void> => {
  const response = await fetch(job.documentUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("Private print document download failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  await acceptPdfIntoSpool(spoolDirectory, job.jobId, bytes, maxBytes);
};

const processOnce = async () => {
  const claim = (await command(
    "/printer-agent/jobs/claim",
    randomUUID(),
  )) as ClaimedJob | null;
  if (!claim) return;
  const statusKey = (status: string) => `${claim.jobId}-${status}-v1-00000000`;
  await command(
    `/printer-agent/jobs/${claim.jobId}/status`,
    statusKey("printing"),
    {
      status: "PRINTING",
    },
  );
  try {
    await acceptIntoSpool(claim);
    await command(
      `/printer-agent/jobs/${claim.jobId}/status`,
      statusKey("completed"),
      {
        status: "COMPLETED",
      },
    );
  } catch {
    await command(
      `/printer-agent/jobs/${claim.jobId}/status`,
      statusKey("failed"),
      {
        status: "FAILED",
        failureCode: "OUTPUT_REJECTED",
      },
    );
  }
};

const run = async () => {
  for (;;) {
    try {
      await processOnce();
    } catch {
      // Deliberately omit identifiers, URLs, tokens and payloads from agent logs.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, pollMs));
  }
};

void run();
