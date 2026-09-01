import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const acceptPdfIntoSpool = async (
  spoolDirectory: string,
  jobId: string,
  bytes: Buffer,
  maxBytes: number,
): Promise<string> => {
  if (
    bytes.length < 5 ||
    bytes.length > maxBytes ||
    bytes.subarray(0, 5).toString() !== "%PDF-"
  )
    throw new Error("Print document failed local validation");
  await mkdir(spoolDirectory, { recursive: true, mode: 0o700 });
  const temporary = join(spoolDirectory, `.${randomUUID()}.pending`);
  const accepted = join(spoolDirectory, `${jobId}.pdf`);
  await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
  await rename(temporary, accepted);
  return accepted;
};
