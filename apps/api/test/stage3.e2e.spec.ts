import "reflect-metadata";
import "./test-environment";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { PDFDocument } from "pdf-lib";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import yazl from "yazl";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { OutboxDispatcherService } from "../src/uploads/outbox-dispatcher.service";
import { PrivateObjectStorageService } from "../src/uploads/private-object-storage.service";
import { ProcessingResultService } from "../src/uploads/processing-result.service";
import { UploadService } from "../src/uploads/upload.service";

const enabled = process.env.RUN_STAGE3_E2E === "1";
const origin = "http://localhost:3000";
const docxMime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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
    archive.addBuffer(Buffer.from("<Types/>"), "[Content_Types].xml");
    archive.addBuffer(Buffer.from("<w:document/>"), "word/document.xml");
    for (const extra of extras) archive.addBuffer(extra.value, extra.name);
    archive.end();
  });

describe.skipIf(!enabled)(
  "stage 3 upload and processing foundation e2e",
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let storage: PrivateObjectStorageService;
    let uploads: UploadService;
    let dispatcher: OutboxDispatcherService;
    let results: ProcessingResultService;
    let agent: ReturnType<typeof request.agent>;
    let csrfToken: string;
    let userId: string;

    beforeAll(async () => {
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = module.createNestApplication();
      app.setGlobalPrefix("api/v1");
      app.use(cookieParser());
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
      prisma = app.get(PrismaService);
      storage = app.get(PrivateObjectStorageService);
      uploads = app.get(UploadService);
      dispatcher = app.get(OutboxDispatcherService);
      results = app.get(ProcessingResultService);
      await prisma.$transaction([
        prisma.inboxOperation.deleteMany(),
        prisma.outboxEvent.deleteMany(),
        prisma.processingResult.deleteMany(),
        prisma.processingJob.deleteMany(),
        prisma.uploadSession.deleteMany(),
        prisma.retentionTombstone.deleteMany(),
        prisma.permanentObjectReference.deleteMany(),
        prisma.auditEvent.deleteMany(),
        prisma.session.deleteMany(),
        prisma.otpChallenge.deleteMany(),
        prisma.userRole.deleteMany(),
        prisma.user.deleteMany(),
      ]);
      agent = request.agent(app.getHttpServer());
      const csrfResponse = await agent.get("/api/v1/auth/csrf").expect(200);
      csrfToken = csrfResponse.body.csrfToken as string;
      const syntheticPhone = "+998000000001";
      await agent
        .post("/api/v1/auth/otp/request")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .send({ phone: syntheticPhone })
        .expect(202);
      const login = await agent
        .post("/api/v1/auth/otp/verify")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .send({ phone: syntheticPhone, code: "000000", locale: "ru" })
        .expect(201);
      csrfToken = login.body.csrfToken as string;
      userId = login.body.user.id as string;
    });

    afterAll(async () => app.close());

    async function upload(
      extension: string,
      declaredMime: string,
      value: Buffer,
      expectedStatus = 200,
    ) {
      const created = await agent
        .post("/api/v1/uploads")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .send({ extension, declaredMime, sizeBytes: value.length })
        .expect(201);
      const response = await agent
        .put(`/api/v1/uploads/${created.body.id as string}/content`)
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .set("Content-Type", "application/octet-stream")
        .send(value)
        .expect(expectedStatus);
      return { id: created.body.id as string, response };
    }

    it("accepts PDF, DOCX, JPG, JPEG and PNG into an opaque queued record", async () => {
      const samples = [
        ["pdf", "application/pdf", await makePdf()],
        ["docx", docxMime, await makeDocx()],
        [
          "jpg",
          "image/jpeg",
          Buffer.from(
            "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EF//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EF//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EF//2Q==",
            "base64",
          ),
        ],
        [
          "jpeg",
          "image/jpeg",
          Buffer.from(
            "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EF//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EF//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EF//2Q==",
            "base64",
          ),
        ],
        [
          "png",
          "image/png",
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64",
          ),
        ],
      ] as const;
      for (const [extension, mime, value] of samples) {
        const accepted = await upload(extension, mime, value);
        expect(accepted.response.body.status).toBe("QUEUED");
        const record = await prisma.uploadSession.findUniqueOrThrow({
          where: { id: accepted.id },
        });
        expect(record.permanentObjectKey).toMatch(/^objects\/[a-f0-9]{64}$/);
        expect(record.permanentObjectKey).not.toContain(extension);
        expect(await storage.exists(record.quarantineObjectKey)).toBe(false);
      }
    });

    it("rejects forbidden extension, mismatch, size, pages, pixels and quota", async () => {
      await agent
        .post("/api/v1/uploads")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .send({
          extension: "svg",
          declaredMime: "image/svg+xml",
          sizeBytes: 10,
        })
        .expect(400);
      await upload("pdf", "image/png", await makePdf(), 422);
      await upload("pdf", "application/pdf", Buffer.from("not-pdf"), 422);
      await upload("pdf", "application/pdf", await makePdf(101), 422);
      const oversizedPixels = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      );
      oversizedPixels.writeUInt32BE(10_000, 16);
      oversizedPixels.writeUInt32BE(5_000, 20);
      await upload("png", "image/png", oversizedPixels, 422);
      await agent
        .post("/api/v1/uploads")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .send({
          extension: "pdf",
          declaredMime: "application/pdf",
          sizeBytes: 26_214_401,
        })
        .expect(413);
      const quotaReservation = await prisma.uploadSession.create({
        data: {
          userId,
          fileKind: "PDF",
          declaredMime: "application/pdf",
          expectedSizeBytes: 262_143_999n,
          quarantineObjectKey: "quarantine/" + "f".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        },
        select: { id: true },
      });
      try {
        await agent
          .post("/api/v1/uploads")
          .set("Origin", origin)
          .set("X-CSRF-Token", csrfToken)
          .send({
            extension: "pdf",
            declaredMime: "application/pdf",
            sizeBytes: 2,
          })
          .expect(413);
      } finally {
        await prisma.uploadSession.delete({
          where: { id: quotaReservation.id },
        });
      }
    });

    it("rejects EICAR and cleans quarantine; antivirus unavailability is fail-closed", async () => {
      const infected = await makeDocx([
        {
          name: "word/eicar.com",
          value: Buffer.from(
            "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
          ),
        },
      ]);
      const rejected = await upload("docx", docxMime, infected, 422);
      const record = await prisma.uploadSession.findUniqueOrThrow({
        where: { id: rejected.id },
      });
      expect(record.status).toBe("REJECTED");
      expect(await storage.exists(record.quarantineObjectKey)).toBe(false);
    });

    it("rejects DOCX bombs and path traversal", async () => {
      const bomb = await makeDocx([
        { name: "word/media.bin", value: Buffer.alloc(12 * 1024 * 1024) },
      ]);
      await upload("docx", docxMime, bomb, 422);
      const traversal = await makeDocx([
        { name: "safe123.txt", value: Buffer.from("x") },
      ]);
      const patched = Buffer.from(
        traversal.toString("latin1").replaceAll("safe123.txt", "../evil.txt"),
        "latin1",
      );
      await upload("docx", docxMime, patched, 422);
    });

    it("dispatches once and makes repeated processing completion idempotent", async () => {
      const accepted = await upload("pdf", "application/pdf", await makePdf());
      await dispatcher.dispatchBatch();
      await dispatcher.dispatchBatch();
      const processingJob = await prisma.processingJob.findFirstOrThrow({
        where: { uploadId: accepted.id },
      });
      const claim = await results.claim(
        processingJob.id,
        processingJob.dedupKey,
      );
      expect(claim.duplicate).toBe(false);
      if (claim.duplicate) throw new Error("claim unexpectedly duplicated");
      const first = await results.complete(
        processingJob.id,
        processingJob.dedupKey,
        claim.leaseOwner,
        await makePdf(),
      );
      const second = await results.complete(
        processingJob.id,
        processingJob.dedupKey,
        claim.leaseOwner,
        await makePdf(),
      );
      expect(second.id).toBe(first.id);
      expect(
        await prisma.processingResult.count({
          where: { jobId: processingJob.id },
        }),
      ).toBe(1);
      expect(
        await prisma.inboxOperation.count({
          where: { dedupKey: processingJob.dedupKey },
        }),
      ).toBe(1);
    });

    it("cancels safely and cleanup is idempotent", async () => {
      const session = await uploads.create(userId, {
        extension: "pdf",
        declaredMime: "application/pdf",
        sizeBytes: 100,
      });
      await uploads.cancel(userId, session.id);
      await expect(uploads.cancel(userId, session.id)).rejects.toThrow();
      await prisma.uploadSession.update({
        where: { id: session.id },
        data: {
          status: "CREATED",
          cancelledAt: null,
          expiresAt: new Date(0),
          version: { increment: 1 },
        },
      });
      expect(await uploads.cleanupExpired()).toBeGreaterThanOrEqual(1);
      expect(await uploads.cleanupExpired()).toBe(0);
    });
  },
);
