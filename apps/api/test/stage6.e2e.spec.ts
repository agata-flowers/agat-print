import "reflect-metadata";
import "./test-environment";
import { createHash, randomUUID } from "node:crypto";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { MatchingQueueService } from "../src/matching/matching-queue.service";
import { MatchingService } from "../src/matching/matching.service";
import { PrismaService } from "../src/prisma/prisma.service";

const enabled = process.env.RUN_STAGE6_E2E === "1";
const origin = "http://localhost:3000";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe.skipIf(!enabled)("stage 6 partner matching and production e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let matching: MatchingService;
  let queue: MatchingQueueService;
  let customerId: string;
  let adminId: string;
  let admin: ReturnType<typeof request.agent>;
  let adminCsrf: string;

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
    matching = app.get(MatchingService);
    queue = app.get(MatchingQueueService);
    await clearDatabase();
    ({ userId: customerId } = await login("+998000000061"));
    ({
      agent: admin,
      csrf: adminCsrf,
      userId: adminId,
    } = await login("+998000000062"));
    await prisma.userRole.create({ data: { userId: adminId, role: "ADMIN" } });
    adminCsrf = (
      await admin
        .post("/api/v1/auth/refresh")
        .set("Origin", origin)
        .set("X-CSRF-Token", adminCsrf)
        .expect(201)
    ).body.csrfToken as string;
  });

  afterAll(async () => app.close());

  async function clearDatabase() {
    await prisma.$transaction([
      prisma.partnerAssignment.deleteMany(),
      prisma.partnerPayoutSnapshot.deleteMany(),
      prisma.partnerOffer.deleteMany(),
      prisma.orderMatching.deleteMany(),
      prisma.branchCapabilityVersion.deleteMany(),
      prisma.providerCallback.deleteMany(),
      prisma.idempotencyRecord.deleteMany(),
      prisma.refundOperation.deleteMany(),
      prisma.payment.deleteMany(),
      prisma.priceSnapshot.deleteMany(),
      prisma.order.deleteMany(),
      prisma.tariffVersion.deleteMany(),
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
      prisma.branch.deleteMany(),
      prisma.partner.deleteMany(),
      prisma.auditEvent.deleteMany(),
      prisma.session.deleteMany(),
      prisma.otpChallenge.deleteMany(),
      prisma.userRole.deleteMany(),
      prisma.user.deleteMany(),
    ]);
  }

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
    return {
      agent,
      csrf: response.body.csrfToken as string,
      userId: response.body.user.id as string,
    };
  }

  async function partner(
    phone: string,
    status: "APPROVED" | "PENDING" = "APPROVED",
    active = true,
  ) {
    const session = await login(phone);
    const record = await prisma.partner.create({
      data: {
        ownerId: session.userId,
        displayName: "Synthetic partner",
        status,
        approvedAt: status === "APPROVED" ? new Date() : null,
        branches: {
          create: {
            name: "Synthetic branch",
            active,
            locationCode: "TASHKENT_CENTRE",
          },
        },
      },
      include: { branches: true },
    });
    if (status === "APPROVED") {
      await prisma.userRole.create({
        data: { userId: session.userId, role: "PARTNER" },
      });
      session.csrf = (
        await session.agent
          .post("/api/v1/auth/refresh")
          .set("Origin", origin)
          .set("X-CSRF-Token", session.csrf)
          .expect(201)
      ).body.csrfToken as string;
    }
    return { ...session, partner: record, branch: record.branches[0]! };
  }

  async function capability(
    branchId: string,
    priority: number,
    kinds = ["PDF"],
  ) {
    return admin
      .post(`/api/v1/admin/branches/${branchId}/capabilities`)
      .set("Origin", origin)
      .set("X-CSRF-Token", adminCsrf)
      .send({
        supportedFileKinds: kinds,
        maxPages: 100,
        maxWidthMm: 500,
        maxHeightMm: 500,
        minDpi: 300,
        priority,
      })
      .expect(201);
  }

  async function paidOrder() {
    const opaque = () => randomUUID().replaceAll("-", "").padEnd(64, "0");
    const upload = await prisma.uploadSession.create({
      data: {
        userId: customerId,
        fileKind: "PDF",
        declaredMime: "application/pdf",
        expectedSizeBytes: 100n,
        actualSizeBytes: 100n,
        sha256: digest(randomUUID()),
        status: "READY",
        quarantineObjectKey: `quarantine/${opaque()}`,
        permanentObjectKey: `objects/${opaque()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const job = await prisma.processingJob.create({
      data: {
        uploadId: upload.id,
        operation: "NORMALIZE",
        settingsHash: digest(randomUUID()),
        dedupKey: digest(randomUUID()),
        resultObjectKey: `results/${opaque()}`,
        status: "SUCCEEDED",
        aggregateVersion: 0,
      },
    });
    const result = await prisma.processingResult.create({
      data: {
        jobId: job.id,
        uploadId: upload.id,
        objectKey: job.resultObjectKey,
        checksum: digest(randomUUID()),
        sizeBytes: 100n,
        pageCount: 2,
      },
    });
    const settingsHash = digest(randomUUID());
    const layout = await prisma.layoutRequest.create({
      data: {
        uploadId: upload.id,
        userId: customerId,
        sourceFileVersion: upload.fileVersion,
        settingsHash,
        settings: { targetWidthMm: 210, targetHeightMm: 297, minDpi: 300 },
        status: "APPROVED",
        version: 1,
      },
    });
    const preview = await prisma.previewVersion.create({
      data: {
        layoutId: layout.id,
        version: 1,
        objectKey: `previews/${opaque()}`,
        checksum: digest(randomUUID()),
        sizeBytes: 100n,
        sourceFileVersion: upload.fileVersion,
        settingsHash,
        originProcessingResultId: result.id,
        pageCount: 2,
      },
    });
    const printReady = await prisma.printReadyVersion.create({
      data: {
        layoutId: layout.id,
        version: 1,
        objectKey: `print-ready/${opaque()}`,
        checksum: digest(randomUUID()),
        sizeBytes: 100n,
        sourceFileVersion: upload.fileVersion,
        settingsHash,
        originProcessingResultId: result.id,
        pageCount: 2,
      },
    });
    const approval = await prisma.layoutApproval.create({
      data: {
        layoutId: layout.id,
        previewVersionId: preview.id,
        userId: customerId,
        layoutVersion: 0,
      },
    });
    await prisma.layoutRequest.update({
      where: { id: layout.id },
      data: {
        latestPreviewId: preview.id,
        latestPrintReadyId: printReady.id,
        currentApprovalId: approval.id,
      },
    });
    let tariff = await prisma.tariffVersion.findFirst({
      where: { status: "ACTIVE" },
    });
    tariff ??= await prisma.tariffVersion.create({
      data: {
        version: 1,
        basePriceMinor: 1000n,
        perPagePriceMinor: 250n,
        createdById: adminId,
      },
    });
    return prisma.order.create({
      data: {
        userId: customerId,
        layoutId: layout.id,
        layoutApprovalId: approval.id,
        printReadyVersionId: printReady.id,
        status: "PAID",
        priceSnapshot: {
          create: {
            tariffVersionId: tariff.id,
            tariffVersion: tariff.version,
            sourceParameters: {
              fileKind: "PDF",
              pageCount: 2,
              layoutSettings: layout.settings,
            },
            lineItems: [],
            quantity: 1,
            subtotalMinor: 1500n,
            totalMinor: 1500n,
            currency: "UZS",
          },
        },
        payment: {
          create: {
            provider: "mock",
            providerPaymentReference: digest(randomUUID()),
            amountMinor: 1500n,
            currency: "UZS",
            status: "SUCCEEDED",
          },
        },
      },
    });
  }

  it("filters and orders candidates, preserves payouts, enforces ownership and manual production", async () => {
    const pending = await partner("+998000000063", "PENDING");
    const inactive = await partner("+998000000064", "APPROVED", false);
    const incompatible = await partner("+998000000065");
    const first = await partner("+998000000066");
    const second = await partner("+998000000067");
    await capability(pending.branch.id, 1);
    await capability(inactive.branch.id, 1);
    await capability(incompatible.branch.id, 1, ["PNG"]);
    await capability(first.branch.id, 10);
    await capability(second.branch.id, 20);
    const order = await paidOrder();
    const delivery = digest(`payment:${order.id}`);
    expect((await matching.startOrder(order.id, delivery)).duplicate).toBe(
      false,
    );
    expect((await matching.startOrder(order.id, delivery)).duplicate).toBe(
      true,
    );
    const offer = await prisma.partnerOffer.findFirstOrThrow({
      where: { orderId: order.id, status: "PENDING" },
      include: { payoutSnapshot: true },
    });
    expect(offer.partnerId).toBe(first.partner.id);
    expect(offer.payoutSnapshot?.partnerPayoutMinor).toBe(1200n);
    expect(offer.payoutSnapshot?.agatCommissionMinor).toBe(300n);
    await expect(
      prisma.partnerPayoutSnapshot.update({
        where: { id: offer.payoutSnapshot!.id },
        data: { partnerPayoutMinor: 1n },
      }),
    ).rejects.toThrow();
    await second.agent
      .post(`/api/v1/partner/offers/${offer.id}/decision`)
      .set("Origin", origin)
      .set("X-CSRF-Token", second.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ decision: "ACCEPT" })
      .expect(404);
    await second.agent
      .post(`/api/v1/partner/orders/${order.id}/print-ready`)
      .set("Origin", origin)
      .set("X-CSRF-Token", second.csrf)
      .set("Idempotency-Key", randomUUID())
      .expect(403);
    const rejectKey = randomUUID();
    await first.agent
      .post(`/api/v1/partner/offers/${offer.id}/decision`)
      .set("Origin", origin)
      .set("X-CSRF-Token", first.csrf)
      .set("Idempotency-Key", rejectKey)
      .send({ decision: "REJECT" })
      .expect(201);
    await first.agent
      .post(`/api/v1/partner/offers/${offer.id}/decision`)
      .set("Origin", origin)
      .set("X-CSRF-Token", first.csrf)
      .set("Idempotency-Key", rejectKey)
      .send({ decision: "ACCEPT" })
      .expect(409);
    const next = await prisma.partnerOffer.findFirstOrThrow({
      where: { orderId: order.id, status: "PENDING" },
    });
    expect(next.partnerId).toBe(second.partner.id);
    const acceptKey = randomUUID();
    await Promise.all([
      second.agent
        .post(`/api/v1/partner/offers/${next.id}/decision`)
        .set("Origin", origin)
        .set("X-CSRF-Token", second.csrf)
        .set("Idempotency-Key", acceptKey)
        .send({ decision: "ACCEPT" })
        .expect(201),
      second.agent
        .post(`/api/v1/partner/offers/${next.id}/decision`)
        .set("Origin", origin)
        .set("X-CSRF-Token", second.csrf)
        .set("Idempotency-Key", acceptKey)
        .send({ decision: "ACCEPT" })
        .expect(201),
    ]);
    expect(
      await prisma.partnerAssignment.count({
        where: { orderId: order.id, active: true },
      }),
    ).toBe(1);
    await second.agent
      .post(`/api/v1/partner/orders/${order.id}/print-ready`)
      .set("Origin", origin)
      .set("X-CSRF-Token", second.csrf)
      .set("Idempotency-Key", randomUUID())
      .expect(201)
      .expect("Cache-Control", "no-store, private");
    await second.agent
      .post(`/api/v1/partner/orders/${order.id}/status`)
      .set("Origin", origin)
      .set("X-CSRF-Token", second.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ status: "READY" })
      .expect(409);
    await second.agent
      .post(`/api/v1/partner/orders/${order.id}/status`)
      .set("Origin", origin)
      .set("X-CSRF-Token", second.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ status: "IN_PRODUCTION" })
      .expect(201);
    await second.agent
      .post(`/api/v1/partner/orders/${order.id}/status`)
      .set("Origin", origin)
      .set("X-CSRF-Token", second.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ status: "READY" })
      .expect(201);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
        .status,
    ).toBe("READY");
  });

  it("expires offers idempotently and requests exactly one refund after exhaustion", async () => {
    await prisma.branch.updateMany({ data: { active: false } });
    const order = await paidOrder();
    await matching.startOrder(order.id, digest(`empty:${order.id}`));
    expect(
      (
        await prisma.orderMatching.findUniqueOrThrow({
          where: { orderId: order.id },
        })
      ).status,
    ).toBe("EXHAUSTED");
    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: order.id, eventType: "MATCHING_EXHAUSTED" },
    });
    const job = {
      data: {
        eventType: "MATCHING_EXHAUSTED",
        aggregateId: order.id,
        dedupKey: event.dedupKey,
      },
    } as never;
    await queue.handle(job);
    await queue.handle(job);
    expect(
      await prisma.refundOperation.count({
        where: { payment: { orderId: order.id } },
      }),
    ).toBe(1);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
        .status,
    ).toBe("REFUND_PENDING");
  });

  it("keeps client responses and telemetry free of payout and storage details", async () => {
    const serialized = JSON.stringify(await matching.adminHistory());
    expect(serialized).not.toMatch(/objectKey|signedUrl|phone|address/i);
    const metrics = (
      await request(app.getHttpServer()).get("/api/v1/metrics").expect(200)
    ).text;
    expect(metrics).not.toMatch(
      /partner_id|offer_id|order_id|payout|object_key|phone|address/i,
    );
  });
});
