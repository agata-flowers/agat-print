import "reflect-metadata";
import "./test-environment";
import { createHash, randomUUID } from "node:crypto";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { MatchingService } from "../src/matching/matching.service";
import { PrismaService } from "../src/prisma/prisma.service";

const enabled = process.env.RUN_STAGE10_E2E === "1";
const origin = "http://localhost:3000";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe.skipIf(!enabled)("stage 10 partner production network DB-E2E", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let matching: MatchingService;
  let customerId: string;
  let adminId: string;
  let admin: ReturnType<typeof request.agent>;
  let adminCsrf: string;
  let tariffId: string;

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
    matching = app.get(MatchingService);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    ({ userId: customerId } = await login("+998000000101"));
    ({
      agent: admin,
      csrf: adminCsrf,
      userId: adminId,
    } = await login("+998000000102"));
    await prisma.userRole.create({ data: { userId: adminId, role: "ADMIN" } });
    adminCsrf = await refresh(admin, adminCsrf);
    tariffId = (
      await prisma.tariffVersion.create({
        data: {
          version: 1,
          basePriceMinor: 1000n,
          perPagePriceMinor: 250n,
          createdById: adminId,
        },
      })
    ).id;
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
    return {
      agent,
      csrf: response.body.csrfToken as string,
      userId: response.body.user.id as string,
    };
  }

  async function refresh(
    agent: ReturnType<typeof request.agent>,
    csrf: string,
  ) {
    return (
      await agent
        .post("/api/v1/auth/refresh")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrf)
        .expect(201)
    ).body.csrfToken as string;
  }

  async function activePartner(
    phone: string,
    priority: number,
    capacity: number,
  ) {
    const session = await login(phone);
    const partner = await prisma.partner.create({
      data: {
        ownerId: session.userId,
        displayName: "Synthetic studio",
        status: "ACTIVE",
        approvedAt: new Date(),
        branches: { create: { name: "Synthetic branch" } },
      },
      include: { branches: true },
    });
    await prisma.userRole.create({
      data: { userId: session.userId, role: "PARTNER" },
    });
    session.csrf = await refresh(session.agent, session.csrf);
    const branch = partner.branches[0]!;
    const mutate = (path: string, body: object, key = randomUUID()) =>
      session.agent
        .post(`/api/v1/partner/network/branches/${branch.id}/${path}`)
        .set("Origin", origin)
        .set("X-CSRF-Token", session.csrf)
        .set("Idempotency-Key", key)
        .send(body)
        .expect(201);
    await mutate("capabilities", {
      supportedFileKinds: ["PDF"],
      maxPages: 100,
      maxWidthMm: 500,
      maxHeightMm: 500,
      minDpi: 300,
      priority,
      serviceCodes: ["DOCUMENT_PRINT"],
      paperCodes: ["STANDARD"],
      colorModes: ["COLOR"],
      equipmentCodes: ["LASER"],
      maxQuantity: 100,
    });
    await mutate("operations", {
      weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        opensMinute: 0,
        closesMinute: 1440,
      })),
      pickupEnabled: true,
      printerAgentEnabled: true,
    });
    await mutate("catalogs", {
      items: [
        {
          serviceCode: "DOCUMENT_PRINT",
          enabled: true,
          paperCodes: ["STANDARD"],
          colorModes: ["COLOR"],
          maxQuantity: 100,
        },
      ],
    });
    await mutate("capacity", { maxConcurrentOrders: capacity });
    return { ...session, partner, branch, mutate };
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
        sha256: hash(randomUUID()),
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
        settingsHash: hash(randomUUID()),
        dedupKey: hash(randomUUID()),
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
        checksum: hash(randomUUID()),
        sizeBytes: 100n,
        pageCount: 2,
      },
    });
    const settingsHash = hash(randomUUID());
    const layout = await prisma.layoutRequest.create({
      data: {
        uploadId: upload.id,
        userId: customerId,
        sourceFileVersion: upload.fileVersion,
        settingsHash,
        settings: {
          targetWidthMm: 210,
          targetHeightMm: 297,
          minDpi: 300,
          serviceCode: "DOCUMENT_PRINT",
          paperCode: "STANDARD",
          colorMode: "COLOR",
          equipmentCodes: ["LASER"],
          latitude: 41.311081,
          longitude: 69.240562,
        },
        status: "APPROVED",
        version: 1,
      },
    });
    const preview = await prisma.previewVersion.create({
      data: {
        layoutId: layout.id,
        version: 1,
        objectKey: `previews/${opaque()}`,
        checksum: hash(randomUUID()),
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
        checksum: hash(randomUUID()),
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
    const tariff = await prisma.tariffVersion.findUniqueOrThrow({
      where: { id: tariffId },
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
            sourceParameters: { fileKind: "PDF", pageCount: 2 },
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
            providerPaymentReference: hash(randomUUID()),
            amountMinor: 1500n,
            currency: "UZS",
            status: "SUCCEEDED",
          },
        },
      },
    });
  }

  it("supports draft submission, moderation and private encrypted contacts", async () => {
    const applicant = await login("+998000000103");
    const key = randomUUID();
    const draft = await applicant.agent
      .post("/api/v1/partners/draft")
      .set("Origin", origin)
      .set("X-CSRF-Token", applicant.csrf)
      .set("Idempotency-Key", key)
      .send({ displayName: "Synthetic draft", branchName: "Draft branch" })
      .expect(201);
    const replay = await applicant.agent
      .post("/api/v1/partners/draft")
      .set("Origin", origin)
      .set("X-CSRF-Token", applicant.csrf)
      .set("Idempotency-Key", key)
      .send({ displayName: "Synthetic draft", branchName: "Draft branch" })
      .expect(201);
    expect(replay.body).toEqual(draft.body);
    await applicant.agent
      .post("/api/v1/partners/draft")
      .set("Origin", origin)
      .set("X-CSRF-Token", applicant.csrf)
      .set("Idempotency-Key", key)
      .send({ displayName: "Changed payload", branchName: "Draft branch" })
      .expect(409);
    const secretContact = "synthetic-operations-contact";
    const profile = await applicant.agent
      .patch("/api/v1/partners/me/profile")
      .set("Origin", origin)
      .set("X-CSRF-Token", applicant.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({
        publicDescription: "Public studio",
        operationalContact: secretContact,
      })
      .expect(200);
    expect(profile.body.hasOperationalContact).toBe(true);
    expect(JSON.stringify(profile.body)).not.toContain(secretContact);
    await applicant.agent
      .post("/api/v1/partners/me/submit")
      .set("Origin", origin)
      .set("X-CSRF-Token", applicant.csrf)
      .set("Idempotency-Key", randomUUID())
      .expect(201);
    await admin
      .post(`/api/v1/admin/partners/${draft.body.id}/lifecycle`)
      .set("Origin", origin)
      .set("X-CSRF-Token", adminCsrf)
      .set("Idempotency-Key", randomUUID())
      .send({ status: "ACTIVE" })
      .expect(201);
    const stored = await prisma.partner.findUniqueOrThrow({
      where: { id: draft.body.id as string },
    });
    expect(stored.status).toBe("ACTIVE");
    expect(stored.operationalContactCiphertext).not.toContain(secretContact);
    const audit = await prisma.auditEvent.findMany({
      where: { actorId: applicant.userId },
    });
    expect(JSON.stringify(audit)).not.toContain(secretContact);
  });

  it("filters and ranks with explainable reasons and reserves final capacity", async () => {
    const first = await activePartner("+998000000104", 10, 1);
    const second = await activePartner("+998000000105", 20, 1);
    const disabled = await activePartner("+998000000106", 1, 2);
    await disabled.mutate("catalogs", {
      items: [
        {
          serviceCode: "DOCUMENT_PRINT",
          enabled: false,
          paperCodes: ["STANDARD"],
          colorModes: ["COLOR"],
          maxQuantity: 100,
        },
      ],
    });
    const outside = await activePartner("+998000000107", 1, 2);
    await outside.agent
      .patch(`/api/v1/partners/me/branches/${outside.branch.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", outside.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ latitude: 42, longitude: 70, serviceRadiusMeters: 1 })
      .expect(200);
    const unavailable = await activePartner("+998000000108", 1, 2);
    const blackout = await unavailable.mutate("availability", {
      kind: "UNAVAILABLE",
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    });

    await first.agent
      .patch(`/api/v1/partners/me/branches/${second.branch.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", first.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ acceptingOrders: false })
      .expect(404);

    const [orderOne, orderTwo] = await Promise.all([paidOrder(), paidOrder()]);
    await Promise.all([
      matching.startOrder(orderOne.id, hash(`stage10:${orderOne.id}`)),
      matching.startOrder(orderTwo.id, hash(`stage10:${orderTwo.id}`)),
    ]);
    const offers = await prisma.partnerOffer.findMany({
      where: { orderId: { in: [orderOne.id, orderTwo.id] }, status: "PENDING" },
      include: { capacityReservation: true },
    });
    expect(offers).toHaveLength(2);
    expect(new Set(offers.map((offer) => offer.partnerId))).toEqual(
      new Set([first.partner.id, second.partner.id]),
    );
    expect(
      offers.every((offer) => offer.capacityReservation?.status === "HELD"),
    ).toBe(true);
    const evaluations = await prisma.matchingCandidateEvaluation.findMany({
      where: { matching: { orderId: orderOne.id } },
    });
    expect(
      evaluations.some((item) => item.reasonCodes.includes("SERVICE_DISABLED")),
    ).toBe(true);
    expect(
      evaluations.some((item) =>
        item.reasonCodes.includes("OUTSIDE_SERVICE_AREA"),
      ),
    ).toBe(true);
    expect(
      evaluations.some((item) =>
        item.reasonCodes.includes("TEMPORARILY_UNAVAILABLE"),
      ),
    ).toBe(true);
    expect(
      await prisma.offerCapacityReservation.count({
        where: { status: "HELD" },
      }),
    ).toBe(2);

    const firstOffer = offers.find(
      (offer) => offer.partnerId === first.partner.id,
    )!;
    await first.mutate("capabilities", {
      supportedFileKinds: ["PDF"],
      maxPages: 100,
      maxWidthMm: 500,
      maxHeightMm: 500,
      minDpi: 300,
      priority: 5,
      serviceCodes: ["DOCUMENT_PRINT"],
      paperCodes: ["STANDARD"],
      colorModes: ["COLOR"],
      equipmentCodes: ["LASER"],
      maxQuantity: 100,
    });
    await first.agent
      .post(`/api/v1/partner/offers/${firstOffer.id}/decision`)
      .set("Origin", origin)
      .set("X-CSRF-Token", first.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ decision: "ACCEPT" })
      .expect(409);
    expect(
      (
        await prisma.offerCapacityReservation.findUniqueOrThrow({
          where: { offerId: firstOffer.id },
        })
      ).status,
    ).toBe("RELEASED");
    await expect(
      prisma.branchCapabilityVersion.update({
        where: { id: firstOffer.capabilityVersionId },
        data: { maxPages: 1 },
      }),
    ).rejects.toThrow();

    const secondOffer = offers.find(
      (offer) => offer.partnerId === second.partner.id,
    )!;
    const acceptKey = randomUUID();
    await Promise.all([
      second.agent
        .post(`/api/v1/partner/offers/${secondOffer.id}/decision`)
        .set("Origin", origin)
        .set("X-CSRF-Token", second.csrf)
        .set("Idempotency-Key", acceptKey)
        .send({ decision: "ACCEPT" })
        .expect(201),
      second.agent
        .post(`/api/v1/partner/offers/${secondOffer.id}/decision`)
        .set("Origin", origin)
        .set("X-CSRF-Token", second.csrf)
        .set("Idempotency-Key", acceptKey)
        .send({ decision: "ACCEPT" })
        .expect(201),
    ]);
    expect(
      await prisma.partnerAssignment.count({
        where: { orderId: secondOffer.orderId, active: true },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.offerCapacityReservation.findUniqueOrThrow({
          where: { offerId: secondOffer.id },
        })
      ).status,
    ).toBe("CONSUMED");

    const pendingOrder = await paidOrder();
    await matching.startOrder(
      pendingOrder.id,
      hash(`stage10:suspension:${pendingOrder.id}`),
    );
    const pendingOffer = await prisma.partnerOffer.findFirstOrThrow({
      where: { orderId: pendingOrder.id, partnerId: first.partner.id },
    });
    await admin
      .post(`/api/v1/admin/partners/${first.partner.id}/lifecycle`)
      .set("Origin", origin)
      .set("X-CSRF-Token", adminCsrf)
      .set("Idempotency-Key", randomUUID())
      .send({ status: "SUSPENDED" })
      .expect(201);
    await first.agent
      .post(`/api/v1/partner/offers/${pendingOffer.id}/decision`)
      .set("Origin", origin)
      .set("X-CSRF-Token", first.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ decision: "ACCEPT" })
      .expect(409);
    expect(
      (
        await prisma.offerCapacityReservation.findUniqueOrThrow({
          where: { offerId: pendingOffer.id },
        })
      ).status,
    ).toBe("RELEASED");

    await admin
      .post(`/api/v1/admin/partners/${second.partner.id}/lifecycle`)
      .set("Origin", origin)
      .set("X-CSRF-Token", adminCsrf)
      .set("Idempotency-Key", randomUUID())
      .send({ status: "SUSPENDED" })
      .expect(201);
    await second.agent
      .post(`/api/v1/partner/orders/${secondOffer.orderId}/status`)
      .set("Origin", origin)
      .set("X-CSRF-Token", second.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ status: "IN_PRODUCTION" })
      .expect(201);
    await second.agent
      .post(`/api/v1/partner/orders/${secondOffer.orderId}/status`)
      .set("Origin", origin)
      .set("X-CSRF-Token", second.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ status: "READY" })
      .expect(201);
    expect(
      (
        await prisma.order.findUniqueOrThrow({
          where: { id: secondOffer.orderId },
        })
      ).status,
    ).toBe("READY");

    const cancellationKey = randomUUID();
    const cancelled = await unavailable.agent
      .post(
        `/api/v1/partner/network/branches/${unavailable.branch.id}/availability/${blackout.body.id}/cancel`,
      )
      .set("Origin", origin)
      .set("X-CSRF-Token", unavailable.csrf)
      .set("Idempotency-Key", cancellationKey)
      .expect(201);
    const replayed = await unavailable.agent
      .post(
        `/api/v1/partner/network/branches/${unavailable.branch.id}/availability/${blackout.body.id}/cancel`,
      )
      .set("Origin", origin)
      .set("X-CSRF-Token", unavailable.csrf)
      .set("Idempotency-Key", cancellationKey)
      .expect(201);
    expect(replayed.body).toEqual(cancelled.body);
    await outside.agent
      .post(
        `/api/v1/partner/network/branches/${unavailable.branch.id}/availability/${blackout.body.id}/cancel`,
      )
      .set("Origin", origin)
      .set("X-CSRF-Token", outside.csrf)
      .set("Idempotency-Key", cancellationKey)
      .expect(403);
  });

  it("keeps reason codes bounded and network telemetry private", async () => {
    const history = await admin.get("/api/v1/admin/matching").expect(200);
    expect(JSON.stringify(history.body)).not.toMatch(
      /operationalContact|Ciphertext|phone|address|objectKey|signedUrl/i,
    );
    const metrics = (
      await request(app.getHttpServer()).get("/api/v1/metrics").expect(200)
    ).text;
    expect(metrics).not.toMatch(
      /partner_id|branch_id|coordinate|contact|order_id|object_key|signed/i,
    );
  });
});
