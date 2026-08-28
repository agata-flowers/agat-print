import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import yazl from "yazl";
import { loadEnvironment } from "../config/environment";
import {
  processingDedupKey,
  UploadPolicyError,
  validateUpload,
} from "./upload-policy";

const environment = loadEnvironment({
  NODE_ENV: "test",
  JWT_ACCESS_SECRET: "x".repeat(32),
});

const makePdf = async (pages = 1): Promise<Buffer> => {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) document.addPage([100, 100]);
  return Buffer.from(await document.save());
};

const makeDocx = (
  extras: Array<{ name: string; value: Buffer }> = [],
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.once("error", reject);
    archive.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
    archive.addBuffer(Buffer.from("<Types></Types>"), "[Content_Types].xml");
    archive.addBuffer(
      Buffer.from("<w:document></w:document>"),
      "word/document.xml",
    );
    for (const extra of extras) archive.addBuffer(extra.value, extra.name);
    archive.end();
  });

describe("stage 3 upload policy", () => {
  it("accepts valid PDF, DOCX, JPEG and PNG signatures", async () => {
    const pdf = await makePdf();
    const docx = await makeDocx();
    const jpeg = Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EF//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EF//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EF//2Q==",
      "base64",
    );
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    await expect(
      validateUpload("PDF", "application/pdf", pdf, environment),
    ).resolves.toMatchObject({ pageCount: 1 });
    await expect(
      validateUpload(
        "DOCX",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        docx,
        environment,
      ),
    ).resolves.toMatchObject({ pageCount: 1 });
    await expect(
      validateUpload("JPEG", "image/jpeg", jpeg, environment),
    ).resolves.toMatchObject({ pageCount: 1, pixelCount: 1n });
    await expect(
      validateUpload("PNG", "image/png", png, environment),
    ).resolves.toMatchObject({ pageCount: 1, pixelCount: 1n });
  });

  it("rejects MIME/signature mismatches and page/pixel limits", async () => {
    await expect(
      validateUpload("PDF", "image/png", await makePdf(), environment),
    ).rejects.toMatchObject({ safeCode: "MIME_EXTENSION_MISMATCH" });
    await expect(
      validateUpload(
        "PDF",
        "application/pdf",
        Buffer.from("not-pdf"),
        environment,
      ),
    ).rejects.toMatchObject({ safeCode: "SIGNATURE_MISMATCH" });
    await expect(
      validateUpload("PDF", "application/pdf", await makePdf(101), environment),
    ).rejects.toMatchObject({ safeCode: "PAGE_LIMIT_EXCEEDED" });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    await expect(
      validateUpload("PNG", "image/png", png, {
        ...environment,
        uploadMaxImagePixels: 0,
      }),
    ).rejects.toMatchObject({ safeCode: "PIXEL_LIMIT_EXCEEDED" });
  });

  it("rejects DOCX compression bombs and path traversal", async () => {
    const bomb = await makeDocx([
      { name: "word/media.bin", value: Buffer.alloc(1024 * 1024) },
    ]);
    await expect(
      validateUpload(
        "DOCX",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        bomb,
        { ...environment, docxMaxCompressionRatio: 10 },
      ),
    ).rejects.toBeInstanceOf(UploadPolicyError);

    const traversal = await makeDocx([
      { name: "safe123.txt", value: Buffer.from("x") },
    ]);
    const patched = Buffer.from(
      traversal.toString("latin1").replaceAll("safe123.txt", "../evil.txt"),
      "latin1",
    );
    await expect(
      validateUpload(
        "DOCX",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        patched,
        environment,
      ),
    ).rejects.toMatchObject({ safeCode: "DOCX_PATH_TRAVERSAL" });
  });

  it("builds a stable deduplication key from all required inputs", () => {
    const first = processingDedupKey("version", "NORMALIZE", "settings");
    expect(first).toHaveLength(64);
    expect(processingDedupKey("version", "NORMALIZE", "settings")).toBe(first);
    expect(processingDedupKey("other", "NORMALIZE", "settings")).not.toBe(
      first,
    );
  });
});
