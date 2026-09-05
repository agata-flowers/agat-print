import "reflect-metadata";
import "./test-environment";
import { createHash, randomUUID } from "node:crypto";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { FulfillmentQueueService } from "../src/fulfillment/fulfillment-queue.service";
import { FulfillmentService } from "../src/fulfillment/fulfillment.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { PrivateObjectStorageService } from "../src/uploads/private-object-storage.service";
import { RetentionWorkerService } from "../src/disputes/retention-worker.service";
import { AftercareQueueService } from "../src/disputes/aftercare-queue.service";
import { CommerceService } from "../src/commerce/commerce.service";
import { MockPaymentProvider } from "../src/commerce/mock-payment.provider";
import { Queue, QueueEvents, Worker } from "bullmq";
import { FinanceQueueService } from "../src/finance/finance-queue.service";
import { FinanceService } from "../src/finance/finance.service";
import { MockFiscalProvider } from "../src/finance/finance.adapters";

const enabled =
  process.env.RUN_STAGE7_E2E === "1" ||
  process.env.RUN_STAGE8_E2E === "1" ||
  process.env.RUN_STAGE9_E2E === "1";
const origin = "http://localhost:3000";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe.skipIf(!enabled)("stage 7 printer, pickup and delivery e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fulfillment: FulfillmentService;
  let queue: FulfillmentQueueService;
  let storage: PrivateObjectStorageService;
  let customer: Awaited<ReturnType<typeof login>>;
  let admin: Awaited<ReturnType<typeof login>>;
  let partner: Awaited<ReturnType<typeof createPartner>>;
  let foreignPartner: Awaited<ReturnType<typeof createPartner>>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ rawBody: true });
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
    fulfillment = app.get(FulfillmentService);
    queue = app.get(FulfillmentQueueService);
    storage = app.get(PrivateObjectStorageService);
    await clearDatabase();
    customer = await login("+998000000071");
    admin = await login("+998000000072");
    await prisma.userRole.create({
      data: { userId: admin.userId, role: "ADMIN" },
    });
    await prisma.userRole.create({
      data: { userId: admin.userId, role: "FINANCE_ADMIN" },
    });
    await refresh(admin);
    partner = await createPartner("+998000000073");
    foreignPartner = await createPartner("+998000000074");
  });

  afterAll(async () => app.close());

  async function clearDatabase() {
    await prisma.$transaction([
      prisma.settlementBatchItem.deleteMany(),
      prisma.settlementBatch.deleteMany(),
      prisma.financialReconciliation.deleteMany(),
      prisma.fiscalReceipt.deleteMany(),
      prisma.fiscalOperation.deleteMany(),
      prisma.partnerLedgerEntry.deleteMany(),
      prisma.financialJob.deleteMany(),
      prisma.printJob.deleteMany(),
      prisma.printerAgent.deleteMany(),
      prisma.deliveryTask.deleteMany(),
      prisma.orderFulfillment.deleteMany(),
      prisma.productionCycle.deleteMany(),
      prisma.courierProfile.deleteMany(),
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
    csrf = response.body.csrfToken as string;
    return { agent, csrf, userId: response.body.user.id as string };
  }

  async function refresh(session: Awaited<ReturnType<typeof login>>) {
    session.csrf = (
      await session.agent
        .post("/api/v1/auth/refresh")
        .set("Origin", origin)
        .set("X-CSRF-Token", session.csrf)
        .expect(201)
    ).body.csrfToken as string;
  }

  async function createPartner(phone: string) {
    const session = await login(phone);
    const record = await prisma.partner.create({
      data: {
        ownerId: session.userId,
        displayName: "Synthetic print partner",
        status: "APPROVED",
        approvedAt: new Date(),
        branches: {
          create: {
            name: "Synthetic branch",
            locationCode: "TASHKENT_CENTRE",
          },
        },
      },
      include: { branches: true },
    });
    await prisma.userRole.create({
      data: { userId: session.userId, role: "PARTNER" },
    });
    await refresh(session);
    return { ...session, record, branch: record.branches[0]! };
  }

  async function createCourier(phone: string, approved = true) {
    const session = await login(phone);
    const response = await session.agent
      .post("/api/v1/couriers")
      .set("Origin", origin)
      .set("X-CSRF-Token", session.csrf)
      .send({
        displayName: "Synthetic courier",
        serviceZone: "TASHKENT_CENTRE",
      })
      .expect(201);
    if (approved) {
      await admin.agent
        .post(`/api/v1/admin/couriers/${response.body.id}/approve`)
        .set("Origin", origin)
        .set("X-CSRF-Token", admin.csrf)
        .expect(201);
      await refresh(session);
    }
    return { ...session, courierId: response.body.id as string };
  }

  async function assignedOrder(
    status: "PARTNER_ACCEPTED" | "READY",
    selectedPartner = partner,
  ) {
    const opaque = () => randomUUID().replaceAll("-", "").padEnd(64, "0");
    const upload = await prisma.uploadSession.create({
      data: {
        userId: customer.userId,
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
    const processingJob = await prisma.processingJob.create({
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
        jobId: processingJob.id,
        uploadId: upload.id,
        objectKey: processingJob.resultObjectKey,
        checksum: digest(randomUUID()),
        sizeBytes: 100n,
        pageCount: 1,
      },
    });
    const settingsHash = digest(randomUUID());
    const layout = await prisma.layoutRequest.create({
      data: {
        uploadId: upload.id,
        userId: customer.userId,
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
        pageCount: 1,
      },
    });
    const printReadyKey = `print-ready/${opaque()}`;
    const syntheticPdf = Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF",
    );
    const printReady = await prisma.printReadyVersion.create({
      data: {
        layoutId: layout.id,
        version: 1,
        objectKey: printReadyKey,
        checksum: digest(randomUUID()),
        sizeBytes: 100n,
        sourceFileVersion: upload.fileVersion,
        settingsHash,
        originProcessingResultId: result.id,
        pageCount: 1,
      },
    });
    await storage.putDocument(printReadyKey, syntheticPdf);
    await storage.putPermanent(upload.permanentObjectKey!, syntheticPdf);
    await prisma.permanentObjectReference.createMany({
      data: [
        {
          objectKey: printReadyKey,
          checksum: createHash("sha256").update(syntheticPdf).digest("hex"),
          retentionClass: "PRINT_READY",
          expiresAt: new Date(Date.now() + 30 * 86400000),
        },
        {
          objectKey: upload.permanentObjectKey!,
          checksum: createHash("sha256").update(syntheticPdf).digest("hex"),
          retentionClass: "ORIGINAL",
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      ],
    });
    const approval = await prisma.layoutApproval.create({
      data: {
        layoutId: layout.id,
        previewVersionId: preview.id,
        userId: customer.userId,
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
        createdById: admin.userId,
      },
    });
    const order = await prisma.order.create({
      data: {
        userId: customer.userId,
        layoutId: layout.id,
        layoutApprovalId: approval.id,
        printReadyVersionId: printReady.id,
        status,
        priceSnapshot: {
          create: {
            tariffVersionId: tariff.id,
            tariffVersion: tariff.version,
            sourceParameters: { fileKind: "PDF", pageCount: 1 },
            lineItems: [],
            quantity: 1,
            subtotalMinor: 1250n,
            totalMinor: 1250n,
            currency: "UZS",
          },
        },
        payment: {
          create: {
            provider: "mock",
            providerPaymentReference: digest(randomUUID()),
            amountMinor: 1250n,
            currency: "UZS",
            status: "SUCCEEDED",
          },
        },
        matching: { create: { status: "ASSIGNED", assignedAt: new Date() } },
      },
    });
    let capability = await prisma.branchCapabilityVersion.findFirst({
      where: { branchId: selectedPartner.branch.id },
    });
    capability ??= await prisma.branchCapabilityVersion.create({
      data: {
        branchId: selectedPartner.branch.id,
        version: 1,
        supportedFileKinds: ["PDF"],
        maxPages: 100,
        maxWidthMm: 500,
        maxHeightMm: 500,
        minDpi: 300,
        createdById: admin.userId,
      },
    });
    const offer = await prisma.partnerOffer.create({
      data: {
        orderId: order.id,
        partnerId: selectedPartner.record.id,
        branchId: selectedPartner.branch.id,
        capabilityVersionId: capability.id,
        candidateRank: 1,
        status: "ACCEPTED",
        expiresAt: new Date(Date.now() + 60_000),
        decidedAt: new Date(),
      },
    });
    const payout = await prisma.partnerPayoutSnapshot.create({
      data: {
        offerId: offer.id,
        customerAmountMinor: 1250n,
        partnerPayoutMinor: 1000n,
        agatCommissionMinor: 250n,
        currency: "UZS",
        ruleVersion: "mvp-v1",
        calculationInputs: { basisPoints: 8000 },
      },
    });
    const assignment = await prisma.partnerAssignment.create({
      data: {
        orderId: order.id,
        offerId: offer.id,
        partnerId: selectedPartner.record.id,
        branchId: selectedPartner.branch.id,
        payoutSnapshotId: payout.id,
        status: status === "READY" ? "READY" : "ACTIVE",
        active: status !== "READY",
        readyAt: status === "READY" ? new Date() : null,
      },
    });
    await prisma.productionCycle.create({
      data: {
        orderId: order.id,
        sequence: 1,
        kind: "ORIGINAL",
        assignmentId: assignment.id,
        printReadyVersionId: printReady.id,
        status: status === "READY" ? "READY" : "CREATED",
      },
    });
    return { order, assignment, payout, printReady, upload };
  }

  const customerPost = (
    path: string,
    key: string,
    body: Record<string, unknown>,
  ) =>
    customer.agent
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", customer.csrf)
      .set("Idempotency-Key", key)
      .send(body);

  it("authenticates a branch printer-agent and processes one leased job exactly once", async () => {
    const seeded = await assignedOrder("PARTNER_ACCEPTED");
    const registered = await admin.agent
      .post(`/api/v1/admin/branches/${partner.branch.id}/printer-agents`)
      .set("Origin", origin)
      .set("X-CSRF-Token", admin.csrf)
      .send({ label: "Synthetic agent" })
      .expect(201);
    expect(registered.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const dedup = digest(`print-job:${seeded.order.id}`);
    await fulfillment.createPrintJob(seeded.order.id, dedup);
    expect(
      (await fulfillment.createPrintJob(seeded.order.id, dedup)).duplicate,
    ).toBe(true);

    await request(app.getHttpServer())
      .post("/api/v1/printer-agent/jobs/claim")
      .set("X-Printer-Agent-Id", registered.body.agentId)
      .set("Authorization", "Bearer invalid-token")
      .set("Idempotency-Key", randomUUID())
      .expect(401);
    const claimKey = randomUUID();
    const claimRequest = () =>
      request(app.getHttpServer())
        .post("/api/v1/printer-agent/jobs/claim")
        .set("X-Printer-Agent-Id", registered.body.agentId)
        .set("Authorization", `Bearer ${registered.body.token}`)
        .set("Idempotency-Key", claimKey)
        .expect(201);
    const [claimed, replay] = await Promise.all([
      claimRequest(),
      claimRequest(),
    ]);
    expect(claimed.body.documentUrl).toContain("X-Amz-Signature");
    expect(replay.body.jobId).toBe(claimed.body.jobId);
    expect(
      await prisma.printJob.count({ where: { orderId: seeded.order.id } }),
    ).toBe(1);
    const idempotencyResponses = await prisma.idempotencyRecord.findMany({
      select: { response: true },
    });
    expect(JSON.stringify(idempotencyResponses)).not.toContain("documentUrl");

    const agentHeaders = {
      "X-Printer-Agent-Id": registered.body.agentId as string,
      Authorization: `Bearer ${registered.body.token}`,
    };
    await request(app.getHttpServer())
      .post(`/api/v1/printer-agent/jobs/${claimed.body.jobId}/status`)
      .set(agentHeaders)
      .set("Idempotency-Key", randomUUID())
      .send({ status: "PRINTING" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/printer-agent/jobs/${claimed.body.jobId}/status`)
      .set(agentHeaders)
      .set("Idempotency-Key", randomUUID())
      .send({ status: "COMPLETED" })
      .expect(201);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: seeded.order.id } }))
        .status,
    ).toBe("READY");
  });

  it("completes customer pickup with a derived one-time PIN and strict partner ownership", async () => {
    const seeded = await assignedOrder("READY");
    const key = randomUUID();
    const requested = await customerPost(
      `/api/v1/orders/${seeded.order.id}/fulfillment`,
      key,
      { mode: "PICKUP" },
    ).expect(201);
    expect(requested.body.completionPin).toMatch(/^\d{6}$/);
    const replay = await customerPost(
      `/api/v1/orders/${seeded.order.id}/fulfillment`,
      key,
      { mode: "PICKUP" },
    ).expect(201);
    expect(replay.body.completionPin).toBe(requested.body.completionPin);
    await customerPost(`/api/v1/orders/${seeded.order.id}/fulfillment`, key, {
      mode: "DELIVERY",
      deliveryAddress: "Synthetic address 1",
    }).expect(409);

    await foreignPartner.agent
      .post(`/api/v1/partner/orders/${seeded.order.id}/pickup/complete`)
      .set("Origin", origin)
      .set("X-CSRF-Token", foreignPartner.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ pin: requested.body.completionPin })
      .expect(404);
    const wrongPinKey = randomUUID();
    const wrongPin =
      requested.body.completionPin === "999999" ? "000000" : "999999";
    await partner.agent
      .post(`/api/v1/partner/orders/${seeded.order.id}/pickup/complete`)
      .set("Origin", origin)
      .set("X-CSRF-Token", partner.csrf)
      .set("Idempotency-Key", wrongPinKey)
      .send({ pin: wrongPin })
      .expect(401);
    await partner.agent
      .post(`/api/v1/partner/orders/${seeded.order.id}/pickup/complete`)
      .set("Origin", origin)
      .set("X-CSRF-Token", partner.csrf)
      .set("Idempotency-Key", wrongPinKey)
      .send({ pin: wrongPin })
      .expect(401);
    expect(
      (
        await prisma.orderFulfillment.findFirstOrThrow({
          where: { orderId: seeded.order.id },
        })
      ).completionAttempts,
    ).toBe(1);
    const completionKey = randomUUID();
    await Promise.all(
      [0, 1].map(() =>
        partner.agent
          .post(`/api/v1/partner/orders/${seeded.order.id}/pickup/complete`)
          .set("Origin", origin)
          .set("X-CSRF-Token", partner.csrf)
          .set("Idempotency-Key", completionKey)
          .send({ pin: requested.body.completionPin })
          .expect(201),
      ),
    );
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: seeded.order.id } }))
        .status,
    ).toBe("COMPLETED");
    const fulfillmentRow = await prisma.orderFulfillment.findFirstOrThrow({
      where: { orderId: seeded.order.id },
    });
    expect(JSON.stringify(fulfillmentRow)).not.toContain(
      requested.body.completionPin,
    );
  });

  it("encrypts delivery data, isolates roles and reaches COMPLETED through courier handoff", async () => {
    const courier = await createCourier("+998000000075");
    const foreignCourier = await createCourier("+998000000076");
    const seeded = await assignedOrder("READY");
    const address = "Synthetic street 7, unit 4";
    const requested = await customerPost(
      `/api/v1/orders/${seeded.order.id}/fulfillment`,
      randomUUID(),
      { mode: "DELIVERY", deliveryAddress: address },
    ).expect(201);
    const fulfillmentRow = await prisma.orderFulfillment.findFirstOrThrow({
      where: { orderId: seeded.order.id },
    });
    expect(fulfillmentRow.addressCiphertext).not.toContain(address);
    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: seeded.order.id, eventType: "DELIVERY_REQUESTED" },
    });
    const first = await fulfillment.assignDelivery(
      seeded.order.id,
      event.dedupKey,
    );
    expect(first.duplicate).toBe(false);
    expect(
      (await fulfillment.assignDelivery(seeded.order.id, event.dedupKey))
        .duplicate,
    ).toBe(true);
    const delivery = await prisma.deliveryTask.findFirstOrThrow({
      where: { orderId: seeded.order.id },
    });
    expect(delivery.courierId).toBe(courier.courierId);

    const foreignActive = await foreignCourier.agent
      .get("/api/v1/courier/deliveries/active")
      .expect(200);
    expect(foreignActive.body.delivery).toBeNull();
    const active = await courier.agent
      .get("/api/v1/courier/deliveries/active")
      .expect(200);
    expect(active.body.delivery.deliveryAddress).toBe(address);
    expect(active.body.delivery.handoffPin).toMatch(/^\d{6}$/);
    await foreignPartner.agent
      .post(`/api/v1/partner/deliveries/${delivery.id}/handoff`)
      .set("Origin", origin)
      .set("X-CSRF-Token", foreignPartner.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ pin: active.body.delivery.handoffPin })
      .expect(404);
    await partner.agent
      .post(`/api/v1/partner/deliveries/${delivery.id}/handoff`)
      .set("Origin", origin)
      .set("X-CSRF-Token", partner.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ pin: active.body.delivery.handoffPin })
      .expect(201);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: seeded.order.id } }))
        .status,
    ).toBe("IN_DELIVERY");

    await foreignCourier.agent
      .post(`/api/v1/courier/deliveries/${delivery.id}/complete`)
      .set("Origin", origin)
      .set("X-CSRF-Token", foreignCourier.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ pin: requested.body.completionPin })
      .expect(404);
    const completeKey = randomUUID();
    await Promise.all(
      [0, 1].map(() =>
        courier.agent
          .post(`/api/v1/courier/deliveries/${delivery.id}/complete`)
          .set("Origin", origin)
          .set("X-CSRF-Token", courier.csrf)
          .set("Idempotency-Key", completeKey)
          .send({ pin: requested.body.completionPin })
          .expect(201),
      ),
    );
    const view = await customer.agent
      .get(`/api/v1/orders/${seeded.order.id}`)
      .expect(200);
    expect(view.body.status).toBe("COMPLETED");
    expect(JSON.stringify(view.body)).not.toMatch(
      /payout|commission|addressCiphertext|providerReference/i,
    );
  });

  it("fails closed when no courier exists and preserves immutable financial snapshots", async () => {
    await prisma.courierProfile.updateMany({ data: { active: false } });
    const seeded = await assignedOrder("READY");
    await customerPost(
      `/api/v1/orders/${seeded.order.id}/fulfillment`,
      randomUUID(),
      {
        mode: "DELIVERY",
        deliveryAddress: "Synthetic unavailable zone address",
      },
    ).expect(201);
    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: seeded.order.id, eventType: "DELIVERY_REQUESTED" },
    });
    await fulfillment.assignDelivery(seeded.order.id, event.dedupKey);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: seeded.order.id } }))
        .status,
    ).toBe("DELIVERY_FAILED");
    await expect(
      prisma.partnerPayoutSnapshot.update({
        where: { id: seeded.payout.id },
        data: { partnerPayoutMinor: 1n },
      }),
    ).rejects.toThrow();
    expect(await queue.dispatchBatch()).toBeGreaterThanOrEqual(0);
  });

  describe.skipIf(
    process.env.RUN_STAGE8_E2E !== "1" && process.env.RUN_STAGE9_E2E !== "1",
  )("stage 8 aftercare DB-E2E", () => {
    const partnerPost = (
      path: string,
      key: string,
      body: Record<string, unknown>,
    ) =>
      partner.agent
        .post(path)
        .set("Origin", origin)
        .set("X-CSRF-Token", partner.csrf)
        .set("Idempotency-Key", key)
        .send(body);
    const adminPost = (
      path: string,
      key: string,
      body: Record<string, unknown>,
    ) =>
      admin.agent
        .post(path)
        .set("Origin", origin)
        .set("X-CSRF-Token", admin.csrf)
        .set("Idempotency-Key", key)
        .send(body);
    const open = (orderId: string, key = randomUUID()) =>
      customerPost(`/api/v1/orders/${orderId}/disputes`, key, {
        category: "PRINT_QUALITY",
        structuredComment: "Synthetic bounded comment",
      });
    const decide = (
      id: string,
      resolution: string,
      amount?: string,
      key = randomUUID(),
    ) =>
      adminPost(`/api/v1/admin/disputes/${id}/decision`, key, {
        resolution,
        ...(amount ? { refundAmountMinor: amount } : {}),
      });

    async function completedOrder() {
      const seeded = await assignedOrder("READY");
      const requested = await customerPost(
        `/api/v1/orders/${seeded.order.id}/fulfillment`,
        randomUUID(),
        { mode: "PICKUP" },
      ).expect(201);
      await partnerPost(
        `/api/v1/partner/orders/${seeded.order.id}/pickup/complete`,
        randomUUID(),
        { pin: requested.body.completionPin },
      ).expect(201);
      return { ...seeded, oldPin: requested.body.completionPin as string };
    }

    it("enforces the 72-hour boundary, ownership, roles and conflicting keys", async () => {
      const seeded = await completedOrder();
      await customer.agent
        .post(`/api/v1/orders/${seeded.order.id}/disputes`)
        .set("Origin", origin)
        .set("X-CSRF-Token", customer.csrf)
        .send({ category: "PRINT_QUALITY" })
        .expect(409);
      await customer.agent
        .post(`/api/v1/orders/${seeded.order.id}/disputes`)
        .set("Origin", "https://foreign.invalid")
        .set("X-CSRF-Token", customer.csrf)
        .set("Idempotency-Key", randomUUID())
        .send({ category: "PRINT_QUALITY" })
        .expect(403);
      const key = randomUUID();
      const [first, replay] = await Promise.all([
        open(seeded.order.id, key).expect(201),
        open(seeded.order.id, key).expect(201),
      ]);
      expect(first.body).toEqual(replay.body);
      await customerPost(`/api/v1/orders/${seeded.order.id}/disputes`, key, {
        category: "DAMAGED",
      }).expect(409);
      await foreignPartner.agent
        .post(`/api/v1/orders/${seeded.order.id}/disputes`)
        .set("Origin", origin)
        .set("X-CSRF-Token", foreignPartner.csrf)
        .set("Idempotency-Key", key)
        .send({ category: "PRINT_QUALITY" })
        .expect(404);
      await customerPost(
        `/api/v1/admin/disputes/${first.body.disputeId}/decision`,
        randomUUID(),
        { resolution: "NO_ACTION" },
      ).expect(403);
      await partnerPost(
        `/api/v1/partner/disputes/${first.body.disputeId}/response`,
        randomUUID(),
        { responseCode: "ACKNOWLEDGED" },
      ).expect(201);
      await foreignPartner.agent
        .post(`/api/v1/partner/disputes/${first.body.disputeId}/response`)
        .set("Origin", origin)
        .set("X-CSRF-Token", foreignPartner.csrf)
        .set("Idempotency-Key", randomUUID())
        .send({ responseCode: "DISAGREES" })
        .expect(404);
      const results = await Promise.all([
        decide(first.body.disputeId, "NO_ACTION"),
        decide(first.body.disputeId, "NO_ACTION"),
      ]);
      expect(results.map((x) => x.status).sort()).toEqual([201, 409]);
      const row = await prisma.order.findUniqueOrThrow({
        where: { id: seeded.order.id },
      });
      expect(row.disputeEligibleAt).not.toBeNull();
      await prisma.order.update({
        where: { id: seeded.order.id },
        data: { disputeEligibleAt: new Date(Date.now() - 72 * 3600000) },
      });
      await open(seeded.order.id).expect(409);
      expect(
        await prisma.disputeResolution.count({
          where: { disputeId: first.body.disputeId },
        }),
      ).toBe(1);
      await expect(
        prisma.disputeResolution.update({
          where: { disputeId: first.body.disputeId },
          data: { type: "REPRINT" },
        }),
      ).rejects.toThrow();
    });

    it("resolves partial/full refunds only through signed callbacks, with replay and DB amount guards", async () => {
      for (const resolution of ["PARTIAL_REFUND", "FULL_REFUND"]) {
        const seeded = await completedOrder();
        const dispute = await open(seeded.order.id).expect(201);
        const decision = await decide(
          dispute.body.disputeId,
          resolution,
          resolution === "PARTIAL_REFUND" ? "250" : undefined,
        ).expect(201);
        expect(decision.body.orderStatus).toBe("REFUND_PENDING");
        const refund = await prisma.refundOperation.findUniqueOrThrow({
          where: { id: decision.body.refundOperationId },
        });
        expect(refund.providerRefundReference).toBeNull();
        const commerce = app.get(CommerceService);
        await Promise.all([
          commerce.dispatchRefundOperation(refund.id),
          commerce.dispatchRefundOperation(refund.id),
        ]);
        const dispatched = await prisma.refundOperation.findUniqueOrThrow({
          where: { id: refund.id },
        });
        const callback = {
          eventId: randomUUID(),
          paymentReference: dispatched.providerRefundReference!,
          outcome: "REFUND_SUCCEEDED" as const,
        };
        const provider = app.get(MockPaymentProvider);
        await request(app.getHttpServer())
          .post("/api/v1/payments/mock/callback")
          .set("X-Provider-Signature", "0".repeat(64))
          .send(callback)
          .expect(403);
        const send = () =>
          request(app.getHttpServer())
            .post("/api/v1/payments/mock/callback")
            .set(
              "X-Provider-Signature",
              provider.sign(JSON.stringify(callback)),
            )
            .send(callback)
            .expect(201);
        const confirmed = await Promise.all([send(), send()]);
        expect(confirmed[0].body).toEqual(confirmed[1].body);
        expect(confirmed[0].body.orderStatus).toBe(
          resolution === "FULL_REFUND" ? "REFUNDED" : "PARTIALLY_REFUNDED",
        );
        expect(
          await prisma.refundOperation.count({
            where: { disputeId: dispute.body.disputeId },
          }),
        ).toBe(1);
        await expect(
          prisma.refundOperation.create({
            data: {
              paymentId: refund.paymentId,
              amountMinor: 1251n,
              triggerDedupKey: digest(randomUUID()),
            },
          }),
        ).rejects.toThrow();
        await expect(
          prisma.priceSnapshot.update({
            where: { orderId: seeded.order.id },
            data: { totalMinor: 1n },
          }),
        ).rejects.toThrow();
      }
    });

    it.each(["MANUAL", "AGENT"])(
      "reprints the immutable layout via %s with a fresh cycle and PIN",
      async (mode) => {
        const seeded = await completedOrder();
        const dispute = await open(seeded.order.id).expect(201);
        await decide(dispute.body.disputeId, "REPRINT", "1").expect(409);
        const key = randomUUID();
        const [first, repeated] = await Promise.all([
          decide(dispute.body.disputeId, "REPRINT", undefined, key).expect(201),
          decide(dispute.body.disputeId, "REPRINT", undefined, key).expect(201),
        ]);
        expect(first.body).toEqual(repeated.body);
        const cycles = await prisma.productionCycle.findMany({
          where: { orderId: seeded.order.id },
          orderBy: { sequence: "asc" },
        });
        expect(cycles).toHaveLength(2);
        expect(cycles[1]!.printReadyVersionId).toBe(seeded.printReady.id);
        expect(
          await prisma.printJob.count({
            where: { productionCycleId: cycles[1]!.id },
          }),
        ).toBe(1);
        if (mode === "MANUAL") {
          await partnerPost(
            `/api/v1/partner/orders/${seeded.order.id}/status`,
            randomUUID(),
            { status: "IN_PRODUCTION" },
          ).expect(201);
          await partnerPost(
            `/api/v1/partner/orders/${seeded.order.id}/status`,
            randomUUID(),
            { status: "READY" },
          ).expect(201);
        } else {
          const registered = await admin.agent
            .post(`/api/v1/admin/branches/${partner.branch.id}/printer-agents`)
            .set("Origin", origin)
            .set("X-CSRF-Token", admin.csrf)
            .send({ label: "Synthetic reprint agent" })
            .expect(201);
          const machine = (path: string, body: Record<string, unknown> = {}) =>
            request(app.getHttpServer())
              .post(path)
              .set("X-Printer-Agent-Id", registered.body.agentId)
              .set("Authorization", "Bearer " + registered.body.token)
              .set("Idempotency-Key", randomUUID())
              .send(body);
          const claimed = await machine(
            "/api/v1/printer-agent/jobs/claim",
          ).expect(201);
          expect(claimed.body.jobId).toBe(
            (
              await prisma.printJob.findUniqueOrThrow({
                where: { productionCycleId: cycles[1]!.id },
              })
            ).id,
          );
          await machine(
            `/api/v1/printer-agent/jobs/${claimed.body.jobId}/status`,
            { status: "PRINTING" },
          ).expect(201);
          await machine(
            `/api/v1/printer-agent/jobs/${claimed.body.jobId}/status`,
            { status: "COMPLETED" },
          ).expect(201);
        }
        const requested = await customerPost(
          `/api/v1/orders/${seeded.order.id}/fulfillment`,
          randomUUID(),
          { mode: "PICKUP" },
        ).expect(201);
        await partnerPost(
          `/api/v1/partner/orders/${seeded.order.id}/pickup/complete`,
          randomUUID(),
          { pin: seeded.oldPin },
        ).expect(401);
        await partnerPost(
          `/api/v1/partner/orders/${seeded.order.id}/pickup/complete`,
          randomUUID(),
          { pin: requested.body.completionPin },
        ).expect(201);
        expect(
          await prisma.orderFulfillment.count({
            where: { orderId: seeded.order.id },
          }),
        ).toBe(2);
        expect(
          (
            await prisma.order.findUniqueOrThrow({
              where: { id: seeded.order.id },
            })
          ).status,
        ).toBe("COMPLETED");
        expect(
          (
            await prisma.partnerPayoutSnapshot.findUniqueOrThrow({
              where: { id: seeded.payout.id },
            })
          ).partnerPayoutMinor,
        ).toBe(seeded.payout.partnerPayoutMinor);
      },
    );

    it("delivers a reprint through a fresh courier fulfillment without reusing the old PIN", async () => {
      const seeded = await completedOrder();
      const dispute = await open(seeded.order.id).expect(201);
      await decide(dispute.body.disputeId, "REPRINT").expect(201);
      await partnerPost(
        `/api/v1/partner/orders/${seeded.order.id}/status`,
        randomUUID(),
        { status: "IN_PRODUCTION" },
      ).expect(201);
      await partnerPost(
        `/api/v1/partner/orders/${seeded.order.id}/status`,
        randomUUID(),
        { status: "READY" },
      ).expect(201);
      const courier = await createCourier("+998000000079");
      const requested = await customerPost(
        `/api/v1/orders/${seeded.order.id}/fulfillment`,
        randomUUID(),
        {
          mode: "DELIVERY",
          deliveryAddress: "Synthetic reprint delivery address",
        },
      ).expect(201);
      const event = await prisma.outboxEvent.findFirstOrThrow({
        where: {
          aggregateId: seeded.order.id,
          eventType: "DELIVERY_REQUESTED",
        },
        orderBy: { aggregateVersion: "desc" },
      });
      await fulfillment.assignDelivery(seeded.order.id, event.dedupKey);
      expect(
        (await fulfillment.assignDelivery(seeded.order.id, event.dedupKey))
          .duplicate,
      ).toBe(true);
      const active = await courier.agent
        .get("/api/v1/courier/deliveries/active")
        .expect(200);
      await partnerPost(
        `/api/v1/partner/deliveries/${active.body.delivery.id}/handoff`,
        randomUUID(),
        { pin: active.body.delivery.handoffPin },
      ).expect(201);
      const complete = (pin: string, key: string) =>
        courier.agent
          .post(
            `/api/v1/courier/deliveries/${active.body.delivery.id}/complete`,
          )
          .set("Origin", origin)
          .set("X-CSRF-Token", courier.csrf)
          .set("Idempotency-Key", key)
          .send({ pin });
      await complete(seeded.oldPin, randomUUID()).expect(401);
      const key = randomUUID();
      const responses = await Promise.all([
        complete(requested.body.completionPin, key).expect(201),
        complete(requested.body.completionPin, key).expect(201),
      ]);
      expect(responses[0].body).toEqual(responses[1].body);
      expect(
        (
          await prisma.order.findUniqueOrThrow({
            where: { id: seeded.order.id },
          })
        ).status,
      ).toBe("COMPLETED");
      expect(
        await prisma.productionCycle.count({
          where: { orderId: seeded.order.id, status: "COMPLETED" },
        }),
      ).toBe(2);
    });

    it("cancels only an unanswered dispute and protects a manual legal hold with RBAC and replay", async () => {
      const seeded = await completedOrder();
      const dispute = await open(seeded.order.id).expect(201);
      const key = randomUUID();
      await customerPost(
        `/api/v1/disputes/${dispute.body.disputeId}/cancel`,
        key,
        {},
      ).expect(201);
      await customerPost(
        `/api/v1/disputes/${dispute.body.disputeId}/cancel`,
        key,
        {},
      ).expect(201);
      const path = `/api/v1/admin/orders/${seeded.order.id}/retention-holds`;
      await customerPost(path, randomUUID(), {
        reasonCode: "LEGAL_REQUEST",
      }).expect(403);
      const holdKey = randomUUID();
      const create = () =>
        admin.agent
          .post(path)
          .set("Origin", origin)
          .set("X-CSRF-Token", admin.csrf)
          .set("Idempotency-Key", holdKey)
          .send({ reasonCode: "LEGAL_REQUEST" })
          .expect(201);
      const held = await create();
      expect((await create()).body).toEqual(held.body);
      const releaseKey = randomUUID();
      const release = () =>
        admin.agent
          .delete(path + "/" + held.body.holdId)
          .set("Origin", origin)
          .set("X-CSRF-Token", admin.csrf)
          .set("Idempotency-Key", releaseKey)
          .expect(200);
      expect((await release()).body).toEqual((await release()).body);
      expect(
        await prisma.legalHold.count({
          where: { orderId: seeded.order.id, releasedAt: null },
        }),
      ).toBe(0);
    });

    it("serializes cumulative refund reservations at the database boundary", async () => {
      const seeded = await completedOrder();
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { orderId: seeded.order.id },
      });
      const reserve = () =>
        prisma.refundOperation.create({
          data: {
            paymentId: payment.id,
            amountMinor: payment.amountMinor - 1n,
            kind: "PARTIAL",
            triggerDedupKey: digest(randomUUID()),
          },
        });
      const results = await Promise.allSettled([reserve(), reserve()]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      const refunds = await prisma.refundOperation.findMany({
        where: { paymentId: payment.id },
      });
      expect(
        refunds.reduce((sum, refund) => sum + refund.amountMinor, 0n),
      ).toBeLessThanOrEqual(payment.amountMinor);
    });

    it("holds objects, supersedes deletion schedules and retries durable tombstones", async () => {
      const seeded = await completedOrder();
      const retention = app.get(RetentionWorkerService);
      await retention.reconcileOrder(seeded.order.id);
      const dispute = await open(seeded.order.id).expect(201);
      await retention.run(new Date(Date.now() + 100 * 86400000));
      expect(await storage.exists(seeded.printReady.objectKey)).toBe(true);
      expect(
        await prisma.retentionTombstone.findUnique({
          where: { objectKey: seeded.printReady.objectKey },
        }),
      ).toBeNull();
      await decide(dispute.body.disputeId, "NO_ACTION").expect(201);
      await retention.reconcileOrder(seeded.order.id);
      await retention.applyDue(new Date(Date.now() + 100 * 86400000));
      // Intent commits before the external delete. A restarted worker uses the tombstone.
      expect(
        (
          await prisma.retentionTombstone.findUniqueOrThrow({
            where: { objectKey: seeded.printReady.objectKey },
          })
        ).applyStatus,
      ).toBe("PENDING");
      await retention.retryTombstones();
      await retention.retryTombstones();
      expect(await storage.exists(seeded.printReady.objectKey)).toBe(false);
      expect(
        (
          await prisma.retentionTombstone.findUniqueOrThrow({
            where: { objectKey: seeded.printReady.objectKey },
          })
        ).applyStatus,
      ).toBe("APPLIED");
      expect(
        await prisma.disputeCase.count({
          where: { id: dispute.body.disputeId },
        }),
      ).toBe(1);
      expect(
        await prisma.payment.count({ where: { orderId: seeded.order.id } }),
      ).toBe(1);
    });

    it("deduplicates aftercare queue delivery and keeps customer/audit representations private", async () => {
      const seeded = await completedOrder();
      const dispute = await open(seeded.order.id).expect(201);
      const aftercare = app.get(AftercareQueueService);
      await aftercare.dispatchBatch();
      const event = await prisma.outboxEvent.findFirstOrThrow({
        where: {
          aggregateId: dispute.body.disputeId,
          eventType: "DISPUTE_OPENED",
        },
      });
      expect((await aftercare.handle(event.dedupKey)).duplicate).toBe(false);
      expect((await aftercare.handle(event.dedupKey)).duplicate).toBe(true);
      const redis = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
      const connection = {
        host: redis.hostname,
        port: Number(redis.port || 6379),
        ...(redis.password
          ? { password: decodeURIComponent(redis.password) }
          : {}),
      };
      const redisQueue = new Queue("aftercare", { connection });
      const events = new QueueEvents("aftercare", { connection });
      const worker = new Worker(
        "aftercare",
        (job) => aftercare.handle(job.data.dedupKey as string),
        { connection },
      );
      worker.on("error", () => undefined);
      try {
        await events.waitUntilReady();
        const repeated = await redisQueue.add(
          "DISPUTE_OPENED",
          { dedupKey: event.dedupKey },
          { jobId: digest(randomUUID()) },
        );
        expect(await repeated.waitUntilFinished(events, 30000)).toEqual({
          duplicate: true,
        });
        expect(
          await prisma.inboxOperation.count({
            where: { dedupKey: event.dedupKey },
          }),
        ).toBe(1);
      } finally {
        await worker.close();
        await events.close();
        await redisQueue.close();
      }
      const customerView = await customer.agent
        .get(`/api/v1/orders/${seeded.order.id}/disputes`)
        .expect(200);
      expect(customerView.headers["cache-control"]).toBe("no-store, private");
      expect(JSON.stringify(customerView.body)).not.toMatch(
        /payout|commission|allocationInputs|objectKey|providerReference/,
      );
      const audit = await prisma.auditEvent.findMany({
        where: { eventType: "AFTERCARE_COMMAND" },
        select: { metadata: true },
      });
      expect(JSON.stringify(audit)).not.toMatch(
        /Synthetic|998|objectKey|X-Amz|pin|address|provider|amount|currency/i,
      );
      expect(
        JSON.stringify(
          await prisma.idempotencyRecord.findMany({
            select: { response: true },
          }),
        ),
      ).not.toContain("X-Amz-Signature");
    });

    describe.skipIf(process.env.RUN_STAGE9_E2E !== "1")(
      "stage 9 production finance DB-E2E",
      () => {
        it("materializes immutable fiscal and partner-ledger records exactly once", async () => {
          const seeded = await completedOrder();
          const payment = await prisma.payment.findUniqueOrThrow({
            where: { orderId: seeded.order.id },
          });
          const paymentEvent = await prisma.outboxEvent.create({
            data: {
              aggregateType: "payment",
              aggregateId: payment.id,
              aggregateVersion: payment.version,
              eventType: "PAYMENT_SUCCEEDED",
              dedupKey: digest(`stage9-payment-${payment.id}`),
              payload: {},
            },
          });
          const financeQueue = app.get(FinanceQueueService);
          const finance = app.get(FinanceService);
          await financeQueue.dispatchBatch();
          const paymentJob = await prisma.financialJob.findUniqueOrThrow({
            where: { dedupKey: paymentEvent.dedupKey },
          });
          expect(
            (await financeQueue.handle(paymentJob.dedupKey)).duplicate,
          ).toBe(false);
          expect(
            (await financeQueue.handle(paymentJob.dedupKey)).duplicate,
          ).toBe(true);
          const fiscal = await prisma.fiscalOperation.findFirstOrThrow({
            where: { paymentId: payment.id, type: "SALE" },
          });
          await finance.dispatchFiscal(fiscal.id);
          expect(
            (
              await prisma.fiscalOperation.findUniqueOrThrow({
                where: { id: fiscal.id },
              })
            ).status,
          ).toBe("CONFIRMED");
          const receipt = await prisma.fiscalReceipt.findUniqueOrThrow({
            where: { fiscalOperationId: fiscal.id },
          });
          await expect(
            prisma.fiscalReceipt.update({
              where: { id: receipt.id },
              data: { issuedAt: new Date() },
            }),
          ).rejects.toThrow();

          const completedEvent = await prisma.outboxEvent.findFirstOrThrow({
            where: {
              aggregateId: seeded.order.id,
              eventType: "ORDER_COMPLETED",
            },
            orderBy: { createdAt: "desc" },
          });
          await finance.materializeEvent(completedEvent.id);
          await finance.materializeEvent(completedEvent.id);
          const earning = await prisma.partnerLedgerEntry.findFirstOrThrow({
            where: { orderId: seeded.order.id, type: "EARNING" },
          });
          expect(earning.amountMinor).toBe(seeded.payout.partnerPayoutMinor);
          expect(
            await prisma.partnerLedgerEntry.count({
              where: { orderId: seeded.order.id, type: "EARNING" },
            }),
          ).toBe(1);
          await expect(
            prisma.partnerLedgerEntry.update({
              where: { id: earning.id },
              data: { amountMinor: 1n },
            }),
          ).rejects.toThrow();
        });

        it("authenticates the provider-neutral webhook and rejects out-of-order delivery", async () => {
          const seeded = await completedOrder();
          const payment = await prisma.payment.findUniqueOrThrow({
            where: { orderId: seeded.order.id },
          });
          const callback = {
            eventId: randomUUID(),
            paymentReference: payment.providerPaymentReference!,
            outcome: "PAYMENT_SUCCEEDED",
          };
          await request(app.getHttpServer())
            .post("/api/v1/payments/webhook")
            .set("X-Provider-Signature", "0".repeat(64))
            .send(callback)
            .expect(403);
          const provider = app.get(MockPaymentProvider);
          const rawCallback = JSON.stringify(callback, null, 2);
          await request(app.getHttpServer())
            .post("/api/v1/payments/webhook")
            .set("Content-Type", "application/json")
            .set("X-Provider-Signature", provider.sign(rawCallback))
            .send(rawCallback)
            .expect(409);
          expect(
            await prisma.providerCallback.count({
              where: { eventId: callback.eventId },
            }),
          ).toBe(0);
        });

        it("enforces finance RBAC and reserves each earning in one settlement", async () => {
          const seeded = await completedOrder();
          const event = await prisma.outboxEvent.findFirstOrThrow({
            where: {
              aggregateId: seeded.order.id,
              eventType: "ORDER_COMPLETED",
            },
            orderBy: { createdAt: "desc" },
          });
          await app.get(FinanceService).materializeEvent(event.id);
          const reprint = await completedOrder();
          const reprintCompletedEvent =
            await prisma.outboxEvent.findFirstOrThrow({
              where: {
                aggregateId: reprint.order.id,
                eventType: "ORDER_COMPLETED",
              },
              orderBy: { createdAt: "desc" },
            });
          await app
            .get(FinanceService)
            .materializeEvent(reprintCompletedEvent.id);
          const reprintDispute = await open(reprint.order.id).expect(201);
          await decide(reprintDispute.body.disputeId, "REPRINT").expect(201);
          const heldEarning = await prisma.partnerLedgerEntry.findFirstOrThrow({
            where: { orderId: reprint.order.id, type: "EARNING" },
          });
          await customerPost(
            "/api/v1/admin/finance/settlement-batches",
            randomUUID(),
            { cutoffAt: new Date().toISOString() },
          ).expect(403);
          const key = randomUUID();
          const create = () =>
            admin.agent
              .post("/api/v1/admin/finance/settlement-batches")
              .set("Origin", origin)
              .set("X-CSRF-Token", admin.csrf)
              .set("Idempotency-Key", key)
              .send({ cutoffAt: new Date().toISOString() });
          const [first, replay] = await Promise.all([
            create().expect(201),
            create().expect(201),
          ]);
          expect(replay.body).toEqual(first.body);
          expect(
            await prisma.settlementBatchItem.count({
              where: { batchId: first.body.id },
            }),
          ).toBeGreaterThan(0);
          expect(
            await prisma.settlementBatchItem.count({
              where: { ledgerEntryId: heldEarning.id },
            }),
          ).toBe(0);
          const second = await admin.agent
            .post("/api/v1/admin/finance/settlement-batches")
            .set("Origin", origin)
            .set("X-CSRF-Token", admin.csrf)
            .set("Idempotency-Key", randomUUID())
            .send({ cutoffAt: new Date().toISOString() });
          expect(second.status).toBe(409);
          const submitKey = randomUUID();
          const submit = () =>
            admin.agent
              .post(
                `/api/v1/admin/finance/settlement-batches/${first.body.id}/submit`,
              )
              .set("Origin", origin)
              .set("X-CSRF-Token", admin.csrf)
              .set("Idempotency-Key", submitKey)
              .send({});
          const submitted = await Promise.all([
            submit().expect(201),
            submit().expect(201),
          ]);
          expect(submitted.map((item) => item.body.status)).toEqual([
            "SUBMITTED",
            "SUBMITTED",
          ]);
        });

        it("creates fiscal and ledger refund adjustments without exceeding immutable sources", async () => {
          const seeded = await completedOrder();
          const completedEvent = await prisma.outboxEvent.findFirstOrThrow({
            where: {
              aggregateId: seeded.order.id,
              eventType: "ORDER_COMPLETED",
            },
            orderBy: { createdAt: "desc" },
          });
          const finance = app.get(FinanceService);
          await finance.materializeEvent(completedEvent.id);
          const dispute = await open(seeded.order.id).expect(201);
          const decision = await decide(
            dispute.body.disputeId,
            "PARTIAL_REFUND",
            "250",
          ).expect(201);
          const commerce = app.get(CommerceService);
          await commerce.dispatchRefundOperation(
            decision.body.refundOperationId,
          );
          await commerce.confirmMockRefund(decision.body.refundOperationId);
          const refundEvent = await prisma.outboxEvent.findFirstOrThrow({
            where: {
              aggregateId: (
                await prisma.payment.findUniqueOrThrow({
                  where: { orderId: seeded.order.id },
                })
              ).id,
              eventType: "REFUND_CONFIRMED",
            },
            orderBy: { createdAt: "desc" },
          });
          await finance.materializeEvent(refundEvent.id);
          await finance.materializeEvent(refundEvent.id);
          const refund = await prisma.refundOperation.findUniqueOrThrow({
            where: { id: decision.body.refundOperationId },
          });
          expect(
            await prisma.fiscalOperation.count({
              where: { refundId: refund.id },
            }),
          ).toBe(1);
          expect(
            await prisma.partnerLedgerEntry.count({
              where: { refundId: refund.id },
            }),
          ).toBe(1);
          const net = await prisma.partnerLedgerEntry.findMany({
            where: { orderId: seeded.order.id },
          });
          const credit = net
            .filter((x) => x.direction === "CREDIT")
            .reduce((sum, x) => sum + x.amountMinor, 0n);
          const debit = net
            .filter((x) => x.direction === "DEBIT")
            .reduce((sum, x) => sum + x.amountMinor, 0n);
          expect(debit).toBeLessThanOrEqual(credit);
          const batch = await finance.createSettlement(
            admin.userId,
            randomUUID(),
            { cutoffAt: new Date().toISOString() },
          );
          expect(BigInt(String(batch.totalMinor))).toBe(credit - debit);
          expect(
            await prisma.settlementBatchItem.count({
              where: {
                batchId: String(batch.id),
                ledgerEntry: { orderId: seeded.order.id },
              },
            }),
          ).toBe(2);
        });

        it("records reconciliation mismatches and safely replays a run", async () => {
          const seeded = await completedOrder();
          const finance = app.get(FinanceService);
          const key = randomUUID();
          const input = { runReference: `stage9-${randomUUID()}` };
          const first = await finance.reconcile(admin.userId, key, input);
          const replay = await finance.reconcile(admin.userId, key, input);
          expect(replay).toEqual(first);
          expect(first.status).toBe("MISMATCH");
          expect(
            await prisma.financialReconciliation.count({
              where: {
                status: "MISMATCH",
                entityId: (
                  await prisma.payment.findUniqueOrThrow({
                    where: { orderId: seeded.order.id },
                  })
                ).id,
              },
            }),
          ).toBe(1);
        });

        it("retries a transient fiscal failure through an idempotent finance-admin command", async () => {
          const seeded = await completedOrder();
          const payment = await prisma.payment.findUniqueOrThrow({
            where: { orderId: seeded.order.id },
          });
          const operation = await prisma.fiscalOperation.create({
            data: {
              id: randomUUID(),
              orderId: seeded.order.id,
              paymentId: payment.id,
              type: "SALE",
              amountMinor: payment.amountMinor,
              currency: "UZS",
              dedupKey: digest(`stage9-fiscal-retry-${payment.id}`),
            },
          });
          const provider = app.get(MockFiscalProvider);
          vi.spyOn(provider, "submit").mockRejectedValueOnce(
            new Error("synthetic temporary failure"),
          );
          await expect(
            app.get(FinanceService).dispatchFiscal(operation.id),
          ).rejects.toThrow("FISCAL_OPERATION_FAILED");
          expect(
            (
              await prisma.fiscalOperation.findUniqueOrThrow({
                where: { id: operation.id },
              })
            ).status,
          ).toBe("RETRY_PENDING");
          const key = randomUUID();
          const retry = () =>
            admin.agent
              .post(`/api/v1/admin/finance/fiscal/${operation.id}/retry`)
              .set("Origin", origin)
              .set("X-CSRF-Token", admin.csrf)
              .set("Idempotency-Key", key)
              .send({});
          expect((await retry().expect(201)).body.status).toBe("PENDING");
          expect((await retry().expect(201)).body.status).toBe("PENDING");
          const financeQueue = app.get(FinanceQueueService);
          await financeQueue.dispatchBatch();
          const retryEvent = await prisma.outboxEvent.findFirstOrThrow({
            where: {
              aggregateId: operation.id,
              eventType: "FISCAL_SUBMIT_REQUESTED",
              aggregateVersion: 1,
            },
          });
          await financeQueue.handle(retryEvent.dedupKey);
          expect(
            (
              await prisma.fiscalOperation.findUniqueOrThrow({
                where: { id: operation.id },
              })
            ).status,
          ).toBe("CONFIRMED");
        });

        it("keeps provider references and financial internals out of customer responses and telemetry", async () => {
          const seeded = await completedOrder();
          const view = await customer.agent
            .get(`/api/v1/orders/${seeded.order.id}`)
            .expect(200);
          expect(JSON.stringify(view.body)).not.toMatch(
            /providerReference|payoutSnapshot|commission|ledger|receiptDigest/i,
          );
          await customer.agent
            .get("/api/v1/partner/finance/ledger")
            .expect(403);
          const metrics = await request(app.getHttpServer())
            .get("/api/v1/metrics")
            .expect(200);
          expect(metrics.text).not.toMatch(
            /orderId|paymentId|providerReference|amountMinor|userId/,
          );
        });
      },
    );
  });
});
