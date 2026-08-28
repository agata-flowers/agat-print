import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import type { UploadFileKind } from "@prisma/client";
import type { AppEnvironment } from "../config/environment";
import { APP_ENVIRONMENT } from "./private-object-storage.service";

@Injectable()
export class CommandIsolatedProcessorService {
  constructor(@Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment) {}

  async normalize(kind: UploadFileKind, input: Buffer): Promise<Buffer> {
    const work = await mkdtemp(join(tmpdir(), "agat-processing-"));
    const inputPath = join(work, "input");
    const outputPath = join(work, "output.pdf");
    try {
      await mkdir(work, { recursive: true });
      await writeFile(inputPath, input, { mode: 0o600 });
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          "sh",
          [this.env.processingRunnerScript, inputPath, outputPath, kind],
          {
            stdio: ["ignore", "ignore", "ignore"],
            env: {
              PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
              PROCESSING_IMAGE: this.env.processingImage,
              PROCESSING_TIMEOUT_SECONDS: String(
                this.env.processingTimeoutSeconds,
              ),
              PROCESSING_SECCOMP_PROFILE: this.env.processingSeccompProfile,
              PROCESSING_MAX_PAGES: String(this.env.uploadMaxPages),
              PROCESSING_MAX_IMAGE_PIXELS: String(
                this.env.uploadMaxImagePixels,
              ),
            },
          },
        );
        child.once("error", reject);
        child.once("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error("Isolated processing failed"));
        });
      });
      const output = await readFile(outputPath);
      if (output.length > this.env.uploadMaxFileBytes)
        throw new Error("Processing output exceeds configured limit");
      return output;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}
