import "reflect-metadata";
import "./test-environment";
import { createHash, randomUUID } from "node:crypto";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { MockPaymentProvider } from "../src/commerce/mock-payment.provider";
import { PrismaService } from "../src/prisma/prisma.service";

const enabled = process.env.RUN_STAGE5_E2E === "1";
const origin = "http://localhost:3000";

describe.skipIf(!enabled)("stage 5 pricing, payment and refund e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customer: ReturnType<typeof request.agent>;
  let other: ReturnType<typeof request.agent>;
  let admin: ReturnType<typeof request.agent>;
  let customerCsrf: string;
  let otherCsrf: string;
  let adminCsrf: string;
  let customerId: string;
  let adminId: string;

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
    await clearDatabase();
    ({
      agent: customer,
      csrf: customerCsrf,
      userId: customerId,
    } = await login("+998000000051"));
    ({ agent: other, csrf: otherCsrf } = await login("+998000000052"));
    ({
      agent: admin,
      csrf: adminCsrf,
      userId: adminId,
    } = await login("+998000000053"));
    await prisma.userRole.create({ data: { userId: adminId, role: "ADMIN" } });
    const refreshedAdmin = await admin
      .post("/api/v1/auth/refresh")
      .set("Origin", origin)
      .set("X-CSRF-Token", adminCsrf)
      .expect(201);
    adminCsrf = refreshedAdmin.body.csrfToken as string;
  });

  afterAll(async () => app.close());

  async function clearDatabase() {
    await prisma.$transaction([
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
    csrf = response.body.csrfToken as string;
    return { agent, csrf, userId: response.body.user.id as string };
  }

  async function seedApproved(
    userId: string,
    status: "APPROVED" | "MANUAL_REVIEW_REQUIRED" = "APPROVED",
  ) {
    const opaque = () => randomUUID().replaceAll("-", "").padEnd(64, "0");
    const upload = await prisma.uploadSession.create({
      data: {
        userId,
        fileKind: "PDF",
        declaredMime: "application/pdf",
        expectedSizeBytes: 100n,
        actualSizeBytes: 100n,
        sha256: digest("source"),
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
        settingsHash: digest("normalize"),
        dedupKey: digest(upload.id),
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
        checksum: digest("pdf"),
        sizeBytes: 100n,
        pageCount: 2,
      },
    });
    const settingsHash = digest("layout-settings");
    const layout = await prisma.layoutRequest.create({
      data: {
        uploadId: upload.id,
        userId,
        sourceFileVersion: upload.fileVersion,
        settingsHash,
        settings: { targetWidthMm: 210, targetHeightMm: 297 },
        status: "AWAITING_APPROVAL",
      },
    });
    const preview = await prisma.previewVersion.create({
      data: {
        layoutId: layout.id,
        version: 1,
        objectKey: `previews/${opaque()}`,
        checksum: digest("preview"),
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
        checksum: digest("print-ready"),
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
        userId,
        layoutVersion: 0,
      },
    });
    await prisma.layoutRequest.update({
      where: { id: layout.id },
      data: {
        latestPreviewId: preview.id,
        latestPrintReadyId: printReady.id,
        currentApprovalId: status === "APPROVED" ? approval.id : null,
        status,
        version: 1,
      },
    });
    return { layout, approval, printReady };
  }

  function digest(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  async function createTariff(base = "1000", page = "250") {
    return admin
      .post("/api/v1/admin/tariffs")
      .set("Origin", origin)
      .set("X-CSRF-Token", adminCsrf)
      .send({ basePriceMinor: base, perPagePriceMinor: page })
      .expect(201);
  }

  async function createOrder(quantity = 2) {
    const seeded = await seedApproved(customerId);
    const response = await customer
      .post("/api/v1/orders")
      .set("Origin", origin)
      .set("X-CSRF-Token", customerCsrf)
      .set("Idempotency-Key", randomUUID())
      .send({ layoutApprovalId: seeded.approval.id, quantity })
      .expect(201);
    return response.body as { id: string; price: { totalMinor: string } };
  }

  async function pay(orderId: string, outcome: "SUCCESS" | "FAILURE") {
    const started = await customer
      .post(`/api/v1/orders/${orderId}/payment`)
      .set("Origin", origin)
      .set("X-CSRF-Token", customerCsrf)
      .set("Idempotency-Key", randomUUID())
      .send({ simulateOutcome: outcome })
      .expect(201);
    return started.body as {
      mockCallback: Record<string, string>;
      mockSignature: string;
    };
  }

  async function callback(
    started: { mockCallback: Record<string, unknown>; mockSignature: string },
    status = 201,
  ) {
    return request(app.getHttpServer())
      .post("/api/v1/payments/mock/callback")
      .set("X-Provider-Signature", started.mockSignature)
      .send(started.mockCallback)
      .expect(status);
  }

  it("enforces tariff RBAC and creates versioned tariffs", async () => {
    await customer
      .post("/api/v1/admin/tariffs")
      .set("Origin", origin)
      .set("X-CSRF-Token", customerCsrf)
      .send({ basePriceMinor: "1000", perPagePriceMinor: "250" })
      .expect(403);
    expect((await createTariff()).body.version).toBe(1);
    expect((await createTariff("2000", "300")).body.version).toBe(2);
    expect(
      await prisma.tariffVersion.count({ where: { status: "ACTIVE" } }),
    ).toBe(1);
  });

  it("creates an order only from the current approval and freezes PriceSnapshot", async () => {
    const stale = await seedApproved(customerId, "MANUAL_REVIEW_REQUIRED");
    await customer
      .post("/api/v1/orders")
      .set("Origin", origin)
      .set("X-CSRF-Token", customerCsrf)
      .set("Idempotency-Key", randomUUID())
      .send({ layoutApprovalId: stale.approval.id, quantity: 1 })
      .expect(409);
    const order = await createOrder();
    const frozen = order.price.totalMinor;
    await createTariff("9000", "900");
    expect(
      (
        await customer
          .get(`/api/v1/orders/${order.id}`)
          .expect(200)
          .expect("Cache-Control", "no-store, private")
      ).body.price.totalMinor,
    ).toBe(frozen);
    expect(
      (
        await prisma.priceSnapshot.findUniqueOrThrow({
          where: { orderId: order.id },
        })
      ).currency,
    ).toBe("UZS");
    await other.get(`/api/v1/orders/${order.id}`).expect(404);
  });

  it("replays matching Idempotency-Key and conflicts on a changed payload", async () => {
    const seeded = await seedApproved(customerId);
    const key = randomUUID();
    const payload = { layoutApprovalId: seeded.approval.id, quantity: 1 };
    const first = await customer
      .post("/api/v1/orders")
      .set("Origin", origin)
      .set("X-CSRF-Token", customerCsrf)
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(201);
    const replay = await customer
      .post("/api/v1/orders")
      .set("Origin", origin)
      .set("X-CSRF-Token", customerCsrf)
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(201);
    expect(replay.body.id).toBe(first.body.id);
    await customer
      .post("/api/v1/orders")
      .set("Origin", origin)
      .set("X-CSRF-Token", customerCsrf)
      .set("Idempotency-Key", key)
      .send({ ...payload, quantity: 2 })
      .expect(409);
  });

  it("handles failed, retried, successful and replayed signed payment callbacks", async () => {
    const order = await createOrder(1);
    const paymentKey = randomUUID();
    const start = () =>
      customer
        .post(`/api/v1/orders/${order.id}/payment`)
        .set("Origin", origin)
        .set("X-CSRF-Token", customerCsrf)
        .set("Idempotency-Key", paymentKey);
    const failedResponse = await start()
      .send({ simulateOutcome: "FAILURE" })
      .expect(201);
    const failed = failedResponse.body as {
      mockCallback: Record<string, string>;
      mockSignature: string;
    };
    expect(
      (await start().send({ simulateOutcome: "FAILURE" }).expect(201)).body
        .mockSignature,
    ).toBe(failed.mockSignature);
    await start().send({ simulateOutcome: "SUCCESS" }).expect(409);
    await callback(failed);
    expect(
      (await customer.get(`/api/v1/orders/${order.id}`).expect(200)).body
        .payment.status,
    ).toBe("FAILED");
    const successful = await pay(order.id, "SUCCESS");
    await request(app.getHttpServer())
      .post("/api/v1/payments/mock/callback")
      .set("X-Provider-Signature", "0".repeat(64))
      .send(successful.mockCallback)
      .expect(403);
    await callback(successful);
    await callback(successful);
    const replayConflict = {
      ...successful.mockCallback,
      outcome: "PAYMENT_FAILED",
    };
    const replayConflictSignature = app
      .get(MockPaymentProvider)
      .sign(JSON.stringify(replayConflict));
    await request(app.getHttpServer())
      .post("/api/v1/payments/mock/callback")
      .set("X-Provider-Signature", replayConflictSignature)
      .send(replayConflict)
      .expect(409);
    expect(
      (await customer.get(`/api/v1/orders/${order.id}`).expect(200)).body
        .status,
    ).toBe("PAID");
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(
      1,
    );
  });

  it("rejects a refund callback before refund request and confirms exactly one refund", async () => {
    const order = await createOrder(1);
    const successful = await pay(order.id, "SUCCESS");
    await callback(successful);
    const wrong = {
      ...successful.mockCallback,
      eventId: randomUUID(),
      outcome: "REFUND_SUCCEEDED",
    };
    const wrongSignature = app
      .get(MockPaymentProvider)
      .sign(JSON.stringify(wrong));
    await request(app.getHttpServer())
      .post("/api/v1/payments/mock/callback")
      .set("X-Provider-Signature", wrongSignature)
      .send(wrong)
      .expect(409);
    const key = randomUUID();
    const body = { syntheticEventReference: `synthetic-${randomUUID()}` };
    const requested = await admin
      .post(`/api/v1/admin/internal/orders/${order.id}/no-executor`)
      .set("Origin", origin)
      .set("X-CSRF-Token", adminCsrf)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    await admin
      .post(`/api/v1/admin/internal/orders/${order.id}/no-executor`)
      .set("Origin", origin)
      .set("X-CSRF-Token", adminCsrf)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    await admin
      .post(`/api/v1/admin/internal/orders/${order.id}/no-executor`)
      .set("Origin", origin)
      .set("X-CSRF-Token", adminCsrf)
      .set("Idempotency-Key", randomUUID())
      .send(body)
      .expect(201);
    expect(
      await prisma.refundOperation.count({
        where: { payment: { orderId: order.id } },
      }),
    ).toBe(1);
    expect(
      (await customer.get(`/api/v1/orders/${order.id}`).expect(200)).body
        .status,
    ).toBe("REFUND_PENDING");
    await callback(requested.body);
    await callback(requested.body);
    expect(
      (await customer.get(`/api/v1/orders/${order.id}`).expect(200)).body
        .status,
    ).toBe("REFUNDED");
  });

  it("keeps financial audit and metric labels free of financial and personal values", async () => {
    const events = await admin.get("/api/v1/admin/finance/audit").expect(200);
    const serialized = JSON.stringify(events.body);
    expect(serialized).not.toMatch(
      /998000000|providerPaymentReference|amountMinor|objectKey|signed/i,
    );
    const metrics = (
      await request(app.getHttpServer()).get("/api/v1/metrics").expect(200)
    ).text;
    expect(metrics).not.toMatch(
      /order_id|user_id|payment_reference|amount_minor|phone/i,
    );
  });
});
