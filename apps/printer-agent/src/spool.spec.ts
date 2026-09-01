import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acceptPdfIntoSpool } from "./spool.js";

let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("printer spool boundary", () => {
  it("atomically accepts a bounded PDF with private permissions", async () => {
    directory = await mkdtemp(join(tmpdir(), "agat-printer-"));
    const value = Buffer.from("%PDF-1.4\n%%EOF");
    const path = await acceptPdfIntoSpool(
      directory,
      "synthetic-job",
      value,
      100,
    );
    expect(await readFile(path)).toEqual(value);
    if (process.platform !== "win32")
      expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("rejects a disguised or oversized payload", async () => {
    directory = await mkdtemp(join(tmpdir(), "agat-printer-"));
    await expect(
      acceptPdfIntoSpool(directory, "bad", Buffer.from("not-pdf"), 100),
    ).rejects.toThrow(/validation/);
    await expect(
      acceptPdfIntoSpool(directory, "large", Buffer.from("%PDF-too-large"), 5),
    ).rejects.toThrow(/validation/);
  });
});
