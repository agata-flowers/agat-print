import "reflect-metadata";
import "./test-environment";
import { createHash, randomUUID } from "node:crypto";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { FulfillmentQueueService } from "../src/fulfillment/fulfillment-queue.service";
import { FulfillmentService } from "../src/fulfillment/fulfillment.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { PrivateObjectStorageService } from "../src/uploads/private-object-storage.service";

const enabled = process.env.RUN_STAGE7_E2E === "1";
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
    fulfillment = app.get(FulfillmentService);
    queue = app.get(FulfillmentQueueService);
    storage = app.get(PrivateObjectStorageService);
    await clearDatabase();
    customer = await login("+998000000071");
    admin = await login("+998000000072");
    await prisma.userRole.create({
      data: { userId: admin.userId, role: "ADMIN" },
    });
    await refresh(admin);
    partner = await createPartner("+998000000073");
    foreignPartner = await createPartner("+998000000074");
  });

  afterAll(async () => app.close());

  async function clearDatabase() {
    await prisma.$transaction([
      prisma.printJob.deleteMany(),
      prisma.printerAgent.deleteMany(),
      prisma.deliveryTask.deleteMany(),
      prisma.orderFulfillment.deleteMany(),
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
    await storage.putDocument(
      printReadyKey,
      Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"),
    );
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
    return { order, assignment, payout };
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
        await prisma.orderFulfillment.findUniqueOrThrow({
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
    const fulfillmentRow = await prisma.orderFulfillment.findUniqueOrThrow({
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
    const fulfillmentRow = await prisma.orderFulfillment.findUniqueOrThrow({
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
    const delivery = await prisma.deliveryTask.findUniqueOrThrow({
      where: { orderId: seeded.order.id },
    });
    expect(delivery.courierId).toBe(courier.courierId);

    const foreignActive = await foreignCourier.agent
      .get("/api/v1/courier/deliveries/active")
      .expect(200);
    expect(foreignActive.body).toBeNull();
    const active = await courier.agent
      .get("/api/v1/courier/deliveries/active")
      .expect(200);
    expect(active.body.deliveryAddress).toBe(address);
    expect(active.body.handoffPin).toMatch(/^\d{6}$/);
    await foreignPartner.agent
      .post(`/api/v1/partner/deliveries/${delivery.id}/handoff`)
      .set("Origin", origin)
      .set("X-CSRF-Token", foreignPartner.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ pin: active.body.handoffPin })
      .expect(404);
    await partner.agent
      .post(`/api/v1/partner/deliveries/${delivery.id}/handoff`)
      .set("Origin", origin)
      .set("X-CSRF-Token", partner.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ pin: active.body.handoffPin })
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
});
