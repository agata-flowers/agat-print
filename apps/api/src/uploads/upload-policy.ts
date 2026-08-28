import { createHash } from "node:crypto";
import { UnprocessableEntityException } from "@nestjs/common";
import type { UploadFileKind } from "@prisma/client";
import { imageSize } from "image-size";
import { PDFDocument } from "pdf-lib";
import yauzl, { type Entry } from "yauzl";
import type { AppEnvironment } from "../config/environment";

const MIME_BY_KIND: Record<UploadFileKind, readonly string[]> = {
  PDF: ["application/pdf"],
  DOCX: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  JPEG: ["image/jpeg"],
  PNG: ["image/png"],
};

export interface ValidatedUpload {
  checksum: string;
  pageCount: number;
  pixelCount?: bigint;
}

export class UploadPolicyError extends UnprocessableEntityException {
  constructor(readonly safeCode: string) {
    super({ code: safeCode });
  }
}

const matchesSignature = (kind: UploadFileKind, value: Buffer): boolean => {
  if (kind === "PDF") return value.subarray(0, 5).equals(Buffer.from("%PDF-"));
  if (kind === "DOCX")
    return (
      value.length >= 4 &&
      value[0] === 0x50 &&
      value[1] === 0x4b &&
      [0x03, 0x05, 0x07].includes(value[2] ?? -1) &&
      [0x04, 0x06, 0x08].includes(value[3] ?? -1)
    );
  if (kind === "JPEG")
    return value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff;
  return value
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
};

const validateDocx = (value: Buffer, env: AppEnvironment): Promise<void> =>
  new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      value,
      {
        lazyEntries: true,
        decodeStrings: true,
        validateEntrySizes: true,
      },
      (openError, zipFile) => {
        if (openError || !zipFile) {
          reject(new UploadPolicyError("DOCX_INVALID_ARCHIVE"));
          return;
        }
        let entries = 0;
        let totalUncompressed = 0;
        let hasContentTypes = false;
        let hasDocument = false;
        const fail = (code: string): void => {
          zipFile.close();
          reject(new UploadPolicyError(code));
        };
        zipFile.on("error", (error: Error) =>
          fail(
            /relative path|absolute path|directory traversal/i.test(
              error.message,
            )
              ? "DOCX_PATH_TRAVERSAL"
              : "DOCX_INVALID_ARCHIVE",
          ),
        );
        zipFile.on("entry", (entry: Entry) => {
          entries += 1;
          const normalized = entry.fileName.replaceAll("\\", "/");
          if (
            normalized.startsWith("/") ||
            /^[A-Za-z]:/.test(normalized) ||
            /(^|\/)\.\.(\/|$)/.test(normalized)
          ) {
            fail("DOCX_PATH_TRAVERSAL");
            return;
          }
          if (entries > env.docxMaxEntries) {
            fail("DOCX_TOO_MANY_ENTRIES");
            return;
          }
          totalUncompressed += entry.uncompressedSize;
          if (totalUncompressed > env.docxMaxUncompressedBytes) {
            fail("DOCX_UNPACKED_SIZE_EXCEEDED");
            return;
          }
          const ratio =
            entry.compressedSize === 0
              ? entry.uncompressedSize === 0
                ? 1
                : Number.POSITIVE_INFINITY
              : entry.uncompressedSize / entry.compressedSize;
          if (ratio > env.docxMaxCompressionRatio) {
            fail("DOCX_COMPRESSION_RATIO_EXCEEDED");
            return;
          }
          if (normalized === "[Content_Types].xml") hasContentTypes = true;
          if (normalized === "word/document.xml") hasDocument = true;
          zipFile.readEntry();
        });
        zipFile.on("end", () => {
          if (!hasContentTypes || !hasDocument) {
            reject(new UploadPolicyError("DOCX_REQUIRED_PART_MISSING"));
            return;
          }
          resolve();
        });
        zipFile.readEntry();
      },
    );
  });

export async function validateUpload(
  kind: UploadFileKind,
  declaredMime: string,
  value: Buffer,
  env: AppEnvironment,
): Promise<ValidatedUpload> {
  if (!MIME_BY_KIND[kind].includes(declaredMime))
    throw new UploadPolicyError("MIME_EXTENSION_MISMATCH");
  if (value.length === 0 || value.length > env.uploadMaxFileBytes)
    throw new UploadPolicyError("FILE_SIZE_EXCEEDED");
  if (!matchesSignature(kind, value))
    throw new UploadPolicyError("SIGNATURE_MISMATCH");

  let pageCount = 1;
  let pixelCount: bigint | undefined;
  if (kind === "PDF") {
    try {
      const document = await PDFDocument.load(value, {
        ignoreEncryption: false,
        updateMetadata: false,
      });
      pageCount = document.getPageCount();
    } catch {
      throw new UploadPolicyError("PDF_INVALID");
    }
    if (pageCount > env.uploadMaxPages)
      throw new UploadPolicyError("PAGE_LIMIT_EXCEEDED");
  } else if (kind === "DOCX") {
    await validateDocx(value, env);
  } else {
    try {
      const dimensions = imageSize(value);
      if (!dimensions.width || !dimensions.height)
        throw new Error("dimensions unavailable");
      pixelCount = BigInt(dimensions.width) * BigInt(dimensions.height);
    } catch {
      throw new UploadPolicyError("IMAGE_DECODE_FAILED");
    }
    if (pixelCount > BigInt(env.uploadMaxImagePixels))
      throw new UploadPolicyError("PIXEL_LIMIT_EXCEEDED");
  }

  return {
    checksum: createHash("sha256").update(value).digest("hex"),
    pageCount,
    ...(pixelCount === undefined ? {} : { pixelCount }),
  };
}

export function processingDedupKey(
  fileVersion: string,
  operation: string,
  settingsHash: string,
): string {
  return createHash("sha256")
    .update(`${fileVersion}\0${operation}\0${settingsHash}`)
    .digest("hex");
}
