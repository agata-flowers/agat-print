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
    const result = await this.run(kind, input, "NORMALIZE");
    return result.output;
  }

  async preflight(
    kind: UploadFileKind,
    input: Buffer,
    settings: {
      targetWidthMm: number;
      targetHeightMm: number;
      photoDocument: boolean;
    },
  ): Promise<{
    output: Buffer;
    metadata: {
      pages: number;
      pageWidthPoints: number;
      pageHeightPoints: number;
      orientation: "PORTRAIT" | "LANDSCAPE";
      printSuitable: boolean;
      effectiveDpi?: number;
      backgroundConfidence?: number;
      headPositionConfidence?: number;
      photoSizeConfidence?: number;
    };
  }> {
    return this.run(kind, input, "PREFLIGHT", settings);
  }

  private async run(
    kind: UploadFileKind,
    input: Buffer,
    operation: "NORMALIZE" | "PREFLIGHT",
    settings?: {
      targetWidthMm: number;
      targetHeightMm: number;
      photoDocument: boolean;
    },
  ) {
    const work = await mkdtemp(join(tmpdir(), "agat-processing-"));
    const inputPath = join(work, "input");
    const outputPath = join(work, "output.pdf");
    try {
      await mkdir(work, { recursive: true });
      await writeFile(inputPath, input, { mode: 0o600 });
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          "sh",
          [
            this.env.processingRunnerScript,
            inputPath,
            outputPath,
            kind,
            operation,
          ],
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
              PROCESSING_TARGET_WIDTH_MM: String(
                settings?.targetWidthMm ?? 210,
              ),
              PROCESSING_TARGET_HEIGHT_MM: String(
                settings?.targetHeightMm ?? 297,
              ),
              PROCESSING_PHOTO_DOCUMENT: String(
                settings?.photoDocument ?? false,
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
      const metadata = JSON.parse(
        await readFile(`${outputPath}.json`, "utf8"),
      ) as {
        pages: number;
        pageWidthPoints: number;
        pageHeightPoints: number;
        orientation: "PORTRAIT" | "LANDSCAPE";
        printSuitable: boolean;
        effectiveDpi?: number;
        backgroundConfidence?: number;
        headPositionConfidence?: number;
        photoSizeConfidence?: number;
      };
      if (
        !Number.isInteger(metadata.pages) ||
        metadata.pages < 1 ||
        metadata.pages > this.env.uploadMaxPages ||
        !Number.isFinite(metadata.pageWidthPoints) ||
        !Number.isFinite(metadata.pageHeightPoints) ||
        typeof metadata.printSuitable !== "boolean" ||
        !["PORTRAIT", "LANDSCAPE"].includes(metadata.orientation)
      )
        throw new Error("Processing metadata is invalid");
      return { output, metadata };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}
