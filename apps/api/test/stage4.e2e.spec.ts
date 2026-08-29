import "reflect-metadata";
import "./test-environment";
import { createHash, randomUUID } from "node:crypto";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { PDFDocument } from "pdf-lib";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { CommandIsolatedProcessorService } from "../src/uploads/command-isolated-processor.service";
import { PrivateObjectStorageService } from "../src/uploads/private-object-storage.service";

const enabled = process.env.RUN_STAGE4_E2E === "1";
const origin = "http://localhost:3000";

const makePdf = async (): Promise<Buffer> => {
  const document = await PDFDocument.create();
  document.addPage([595.28, 841.89]);
  return Buffer.from(await document.save());
};

describe.skipIf(!enabled)("stage 4 preflight and approval e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: PrivateObjectStorageService;
  let output: Buffer;
  let metadata: Record<string, number | string | boolean | undefined>;
  let processorFails = false;
  let customer: ReturnType<typeof request.agent>;
  let other: ReturnType<typeof request.agent>;
  let customerCsrf: string;
  let otherCsrf: string;
  let customerId: string;
  let otherId: string;

  const processor = {
    preflight: async () => {
      if (processorFails) throw new Error("safe processing failure");
      return { output, metadata };
    },
  };

  beforeAll(async () => {
    output = await makePdf();
    metadata = { pages: 1, orientation: "PORTRAIT", printSuitable: true };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CommandIsolatedProcessorService)
      .useValue(processor)
      .compile();
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
    await prisma.$transaction([
      prisma.manualReview.deleteMany(),
      prisma.layoutApproval.deleteMany(),
      prisma.printReadyVersion.deleteMany(),
      prisma.previewVersion.deleteMany(),
      prisma.layoutRequest.deleteMany(),
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
    ({
      agent: customer,
      csrf: customerCsrf,
      userId: customerId,
    } = await login("+998000000041"));
    ({
      agent: other,
      csrf: otherCsrf,
      userId: otherId,
    } = await login("+998000000042"));
  });

  afterAll(async () => app.close());

  async function login(phone: string) {
    const agent = request.agent(app.getHttpServer());
    let csrf = (await agent.get("/api/v1/auth/csrf").expect(200)).body
      .csrfToken as string;
    await agent
      .post("/api/v1/auth/otp/request")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({ phone })
      .expect(202);
    const response = await agent
      .post("/api/v1/auth/otp/verify")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({ phone, code: "000000", locale: "ru" })
      .expect(201);
    csrf = response.body.csrfToken as string;
    return { agent, csrf, userId: response.body.user.id as string };
  }

  async function seedReady(
    userId: string,
    kind: "PDF" | "DOCX" | "JPEG" | "PNG",
  ) {
    const source = Buffer.from(`synthetic-stage4-${kind}`);
    const originalKey = `objects/${randomUUID().replaceAll("-", "").padEnd(64, "0")}`;
    const resultKey = `results/${randomUUID().replaceAll("-", "").padEnd(64, "0")}`;
    await storage.putPermanent(originalKey, source);
    await storage.putPermanent(resultKey, output);
    const upload = await prisma.uploadSession.create({
      data: {
        userId,
        fileKind: kind,
        declaredMime:
          kind === "PDF"
            ? "application/pdf"
            : kind === "DOCX"
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : kind === "JPEG"
                ? "image/jpeg"
                : "image/png",
        expectedSizeBytes: BigInt(source.length),
        actualSizeBytes: BigInt(source.length),
        sha256: createHash("sha256").update(source).digest("hex"),
        status: "READY",
        quarantineObjectKey: `quarantine/${randomUUID().replaceAll("-", "").padEnd(64, "0")}`,
        permanentObjectKey: originalKey,
        expiresAt: new Date(Date.now() + 86_400_000),
        completedAt: new Date(),
      },
    });
    const job = await prisma.processingJob.create({
      data: {
        uploadId: upload.id,
        operation: "NORMALIZE",
        settingsHash: "1".repeat(64),
        dedupKey: createHash("sha256").update(upload.id).digest("hex"),
        resultObjectKey: resultKey,
        status: "SUCCEEDED",
        aggregateVersion: upload.version,
      },
    });
    await prisma.processingResult.create({
      data: {
        jobId: job.id,
        uploadId: upload.id,
        objectKey: resultKey,
        checksum: createHash("sha256").update(output).digest("hex"),
        sizeBytes: BigInt(output.length),
        pageCount: 1,
      },
    });
    return upload;
  }

  function generate(uploadId: string, overrides: Record<string, unknown> = {}) {
    return customer
      .post("/api/v1/layouts")
      .set("Origin", origin)
      .set("X-CSRF-Token", customerCsrf)
      .send({
        uploadId,
        targetWidthMm: 210,
        targetHeightMm: 297,
        minDpi: 150,
        photoDocument: false,
        ...overrides,
      });
  }

  it("creates immutable idempotent preview and print-ready versions for every supported kind", async () => {
    for (const kind of ["PDF", "DOCX", "JPEG", "PNG"] as const) {
      metadata = { pages: 1, orientation: "PORTRAIT", printSuitable: true };
      const upload = await seedReady(customerId, kind);
      const first = await generate(upload.id).expect(201);
      const second = await generate(upload.id).expect(201);
      expect(second.body.id).toBe(first.body.id);
      expect(first.body.status).toBe("AWAITING_APPROVAL");
      expect(
        await prisma.previewVersion.count({
          where: { layoutId: first.body.id },
        }),
      ).toBe(1);
      expect(
        await prisma.printReadyVersion.count({
          where: { layoutId: first.body.id },
        }),
      ).toBe(1);
      const artifact = await prisma.previewVersion.findFirstOrThrow({
        where: { layoutId: first.body.id },
      });
      expect(artifact.checksum).toHaveLength(64);
      expect(artifact.objectKey).toMatch(/^previews\/[a-f0-9]{64}$/);
    }
  });

  it("maps corrupt, encrypted and invalid-conversion processing failures to QUALITY_CHECK_FAILED", async () => {
    for (const kind of ["PDF", "PDF", "DOCX"] as const) {
      processorFails = true;
      const upload = await seedReady(customerId, kind);
      const response = await generate(upload.id).expect(201);
      expect(response.body.status).toBe("QUALITY_CHECK_FAILED");
      expect(response.body.qualityCode).toBe("PREFLIGHT_FAILED");
      processorFails = false;
    }
  });

  it("routes low resolution to quality failure and uncertain document photos to manual review", async () => {
    const low = await seedReady(customerId, "PNG");
    metadata = { pages: 1, orientation: "PORTRAIT", effectiveDpi: 100 };
    expect((await generate(low.id).expect(201)).body.status).toBe(
      "QUALITY_CHECK_FAILED",
    );

    const photo = await seedReady(customerId, "JPEG");
    metadata = {
      pages: 1,
      orientation: "PORTRAIT",
      effectiveDpi: 300,
      backgroundConfidence: 0.5,
      headPositionConfidence: 0.5,
      photoSizeConfidence: 0.5,
    };
    const response = await generate(photo.id, { photoDocument: true }).expect(
      201,
    );
    expect(response.body.status).toBe("MANUAL_REVIEW_REQUIRED");
    expect(
      await prisma.manualReview.count({
        where: { layoutId: response.body.id },
      }),
    ).toBe(1);
  });

  it("enforces ownership, admin review RBAC and safe audit metadata", async () => {
    const review = await prisma.manualReview.findFirstOrThrow({
      where: { status: "PENDING" },
    });
    await customer.get("/api/v1/admin/manual-reviews").expect(403);
    await other.get(`/api/v1/layouts/${review.layoutId}`).expect(404);

    const token = await app.get(JwtService).signAsync({
      sub: otherId,
      roles: ["ADMIN"],
      sid: randomUUID(),
    });
    const admin = request.agent(app.getHttpServer());
    const csrf = "stage4-admin-csrf";
    const cookie = [`agat_access=${token}`, `agat_csrf=${csrf}`];
    await admin
      .get("/api/v1/admin/manual-reviews")
      .set("Cookie", cookie)
      .expect(200);
    const signed = await admin
      .get(`/api/v1/admin/manual-reviews/${review.id}/preview-url`)
      .set("Cookie", cookie)
      .expect(200);
    expect(signed.headers["cache-control"]).toContain("no-store");
    await admin
      .post(`/api/v1/admin/manual-reviews/${review.id}/decision`)
      .set("Cookie", cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({ decision: "APPROVE" })
      .expect(201);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { eventType: "MANUAL_REVIEW_DECIDED" },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(audit.metadata)).not.toMatch(
      /previews\/|object|signed|filename|\+998/i,
    );
  });

  it("allows one current approval and rejects races and stale versions", async () => {
    metadata = { pages: 1, orientation: "PORTRAIT", printSuitable: true };
    const upload = await seedReady(customerId, "PDF");
    const created = await generate(upload.id).expect(201);
    const body = { previewVersionId: created.body.latestPreviewId as string };
    const attempts = await Promise.all([
      customer
        .post(`/api/v1/layouts/${created.body.id}/confirm`)
        .set("Origin", origin)
        .set("X-CSRF-Token", customerCsrf)
        .send(body),
      customer
        .post(`/api/v1/layouts/${created.body.id}/confirm`)
        .set("Origin", origin)
        .set("X-CSRF-Token", customerCsrf)
        .send(body),
    ]);
    expect(attempts.map((item) => item.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.layoutApproval.count({
        where: { layoutId: created.body.id },
      }),
    ).toBe(1);

    const changed = await generate(upload.id, { targetWidthMm: 200 }).expect(
      201,
    );
    expect(changed.body.approved).toBe(false);
    expect(
      await prisma.previewVersion.count({
        where: { layoutId: created.body.id },
      }),
    ).toBe(2);
    await customer
      .post(`/api/v1/layouts/${created.body.id}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", customerCsrf)
      .send(body)
      .expect(409);

    await customer
      .post(`/api/v1/layouts/${created.body.id}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", customerCsrf)
      .send({ previewVersionId: changed.body.latestPreviewId })
      .expect(201);
    const replacement = await seedReady(customerId, "PDF");
    const replaced = await generate(replacement.id, {
      layoutId: created.body.id,
    }).expect(201);
    expect(replaced.body.id).toBe(created.body.id);
    expect(replaced.body.approved).toBe(false);
    expect(
      await prisma.previewVersion.count({
        where: { layoutId: created.body.id },
      }),
    ).toBe(3);
  });

  it("returns no-store private document endpoints and never exposes keys in API views", async () => {
    const layout = await prisma.layoutRequest.findFirstOrThrow({
      where: { userId: customerId, latestPreviewId: { not: null } },
    });
    const response = await customer
      .get(`/api/v1/layouts/${layout.id}`)
      .expect(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["cache-control"]).toContain("private");
    expect(JSON.stringify(response.body)).not.toMatch(
      /previews\/|print-ready\/|objectKey|signed/i,
    );
  });
});
