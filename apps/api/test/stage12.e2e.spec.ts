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

const enabled = process.env.RUN_STAGE12_E2E === "1";
const origin = "http://localhost:3000";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const opaque = (prefix: string) =>
  `${prefix}/${randomUUID().replaceAll("-", "").padEnd(64, "0")}`;

describe.skipIf(!enabled)("stage 12 customer studio marketplace DB-E2E", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let matching: MatchingService;
  let matchingQueue: MatchingQueueService;
  let customer: Awaited<ReturnType<typeof login>>;
  let other: Awaited<ReturnType<typeof login>>;
  let admin: Awaited<ReturnType<typeof login>>;
  let tariffId: string;
  let catalogVersionId: string;
  let catalogItemId: string;

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
    matchingQueue = app.get(MatchingQueueService);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    customer = await login("+998000000131");
    other = await login("+998000000132");
    admin = await login("+998000000133");
    await prisma.userRole.create({
      data: { userId: admin.userId, role: "ADMIN" },
    });
    admin.csrf = await refresh(admin);
    tariffId = (
      await prisma.tariffVersion.create({
        data: {
          version: 1,
          basePriceMinor: 1000n,
          perPagePriceMinor: 250n,
          createdById: admin.userId,
        },
      })
    ).id;
    const catalog = await prisma.platformCatalogVersion.create({
      data: {
        version: 1,
        status: "ACTIVE",
        createdById: admin.userId,
        publishedAt: new Date(),
        items: {
          create: {
            serviceCode: "DOCUMENT_PRINT",
            slug: "document-print",
            titleRu: "Печать документов",
            titleUz: "Hujjat chop etish",
            descriptionRu: "Документы",
            descriptionUz: "Hujjatlar",
            acceptedFileKinds: ["PDF", "DOCX", "JPEG", "PNG"],
            optionSchema: { fields: [] },
            sortOrder: 1,
          },
        },
      },
      include: { items: true },
    });
    catalogVersionId = catalog.id;
    catalogItemId = catalog.items[0]!.id;
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
  async function refresh(session: {
    agent: ReturnType<typeof request.agent>;
    csrf: string;
  }) {
    return (
      await session.agent
        .post("/api/v1/auth/refresh")
        .set("Origin", origin)
        .set("X-CSRF-Token", session.csrf)
        .expect(201)
    ).body.csrfToken as string;
  }
  const mutate = (
    session: Awaited<ReturnType<typeof login>>,
    method: "post" | "put",
    path: string,
    body: object,
    key = randomUUID(),
  ) =>
    session.agent[method](`/api/v1${path}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", session.csrf)
      .set("Idempotency-Key", key)
      .send(body);

  async function createNetwork(phone: string, priority: number) {
    const session = await login(phone);
    await prisma.userRole.create({
      data: { userId: session.userId, role: "PARTNER" },
    });
    session.csrf = await refresh(session);
    const partner = await prisma.partner.create({
      data: {
        ownerId: session.userId,
        displayName: "Synthetic studio",
        status: "ACTIVE",
        approvedAt: new Date(),
        branches: {
          create: {
            name: "Synthetic branch",
            city: "Tashkent",
            district: "Test district",
          },
        },
      },
      include: { branches: true },
    });
    const branch = partner.branches[0]!;
    const capability = await prisma.branchCapabilityVersion.create({
      data: {
        branchId: branch.id,
        version: 1,
        supportedFileKinds: ["PDF", "DOCX", "JPEG", "PNG"],
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
        createdById: session.userId,
      },
    });
    const operational = await prisma.branchOperationalVersion.create({
      data: {
        branchId: branch.id,
        version: 1,
        weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          opensMinute: 0,
          closesMinute: 1440,
        })),
        settings: { pickupEnabled: true },
        createdById: session.userId,
      },
    });
    const catalog = await prisma.branchCatalogVersion.create({
      data: {
        branchId: branch.id,
        version: 1,
        createdById: session.userId,
        items: {
          create: {
            serviceCode: "DOCUMENT_PRINT",
            enabled: true,
            paperCodes: ["STANDARD"],
            colorModes: ["COLOR"],
            maxQuantity: 100,
          },
        },
      },
    });
    const capacity = await prisma.branchCapacityVersion.create({
      data: {
        branchId: branch.id,
        version: 1,
        maxConcurrentOrders: 2,
        createdById: session.userId,
      },
    });
    const draft = await mutate(
      session,
      "put",
      "/partner/network/listing/draft",
      {
        branchId: branch.id,
        publicSlug: `studio-${priority}`,
        titleRu: `Студия ${priority}`,
        titleUz: `Studiya ${priority}`,
        descriptionRu: "Проверенная студия",
        descriptionUz: "Tekshirilgan studiya",
      },
    ).expect(200);
    await mutate(
      session,
      "post",
      `/partner/network/listing/${draft.body.id}/submit`,
      { version: draft.body.version },
    ).expect(201);
    await mutate(
      admin,
      "post",
      `/admin/partner-listings/${draft.body.id}/decision`,
      {
        decision: "PUBLISH",
        version: draft.body.version,
        reasonCode: "APPROVED",
      },
    ).expect(201);
    const listing = await prisma.studioListingVersion.findUniqueOrThrow({
      where: { id: draft.body.id as string },
    });
    return {
      session,
      partner,
      branch,
      capability,
      operational,
      catalog,
      capacity,
      listing,
    };
  }

  async function orderFor(
    network: Awaited<ReturnType<typeof createNetwork>>,
    fallbackPolicy: "ALLOW_ELIGIBLE_ALTERNATIVE" | "STRICT_PREFERENCE",
  ) {
    const upload = await prisma.uploadSession.create({
      data: {
        userId: customer.userId,
        fileKind: "PDF",
        declaredMime: "application/pdf",
        expectedSizeBytes: 100n,
        actualSizeBytes: 100n,
        sha256: hash(randomUUID()),
        status: "READY",
        quarantineObjectKey: opaque("quarantine"),
        permanentObjectKey: opaque("objects"),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const job = await prisma.processingJob.create({
      data: {
        uploadId: upload.id,
        operation: "NORMALIZE",
        settingsHash: hash(randomUUID()),
        dedupKey: hash(randomUUID()),
        resultObjectKey: opaque("results"),
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
        userId: customer.userId,
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
        objectKey: opaque("previews"),
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
        objectKey: opaque("print-ready"),
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
    const tariff = await prisma.tariffVersion.findUniqueOrThrow({
      where: { id: tariffId },
    });
    return prisma.order.create({
      data: {
        userId: customer.userId,
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
        studioSelection: {
          create: {
            mode: "PREFERRED_STUDIO",
            fallbackPolicy,
            listingSequence: network.listing.sequence,
            listing: { connect: { id: network.listing.id } },
            branch: { connect: { id: network.branch.id } },
            capabilityVersion: { connect: { id: network.capability.id } },
            operationalVersion: { connect: { id: network.operational.id } },
            catalogVersion: { connect: { id: network.catalog.id } },
            capacityVersion: { connect: { id: network.capacity.id } },
          },
        },
      },
    });
  }

  it("publishes only eligible moderated listings and keeps the public projection private", async () => {
    const preferred = await createNetwork("+998000000134", 900);
    const response = await request(app.getHttpServer())
      .get("/api/v1/studios?serviceCode=DOCUMENT_PRINT&locale=ru")
      .expect(200)
      .expect("Cache-Control", /no-store.*private/);
    expect(
      response.body.studios.some(
        (item: { slug: string }) => item.slug === preferred.listing.publicSlug,
      ),
    ).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(
      /branchId|partnerId|latitude|longitude|capacity|contact|@[0-9a-f-]{36}/i,
    );
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/studios/${preferred.listing.publicSlug}?locale=uz`)
      .expect(200);
    expect(detail.body.name).toBe("Studiya 900");
    await prisma.partner.update({
      where: { id: preferred.partner.id },
      data: { status: "SUSPENDED" },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/studios/${preferred.listing.publicSlug}`)
      .expect(404);
    await prisma.partner.update({
      where: { id: preferred.partner.id },
      data: { status: "ACTIVE" },
    });
  });

  it("persists an owner-only resumable preference with replay/conflict semantics", async () => {
    const preferred = await createNetwork("+998000000135", 800);
    const draft = await prisma.orderDraft.create({
      data: {
        userId: customer.userId,
        catalogVersionId,
        catalogItemId,
        serviceCode: "DOCUMENT_PRINT",
        locale: "ru",
        configuration: {},
        quantity: 1,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const payload = {
      version: draft.version,
      mode: "PREFERRED_STUDIO",
      fallbackPolicy: "ALLOW_ELIGIBLE_ALTERNATIVE",
      studioSlug: preferred.listing.publicSlug,
    };
    const key = randomUUID();
    const first = await mutate(
      customer,
      "put",
      `/order-drafts/${draft.id}/studio-preference`,
      payload,
      key,
    ).expect(200);
    const replay = await mutate(
      customer,
      "put",
      `/order-drafts/${draft.id}/studio-preference`,
      payload,
      key,
    ).expect(200);
    expect(replay.body).toEqual(first.body);
    await mutate(
      customer,
      "put",
      `/order-drafts/${draft.id}/studio-preference`,
      { ...payload, fallbackPolicy: "STRICT_PREFERENCE" },
      key,
    ).expect(409);
    await mutate(other, "put", `/order-drafts/${draft.id}/studio-preference`, {
      ...payload,
      version: 1,
    }).expect(404);
    const stored = await prisma.orderDraftStudioPreference.findUniqueOrThrow({
      where: { draftId: draft.id },
    });
    expect(stored.branchId).toBe(preferred.branch.id);
    expect(stored.capabilityVersionId).toBe(preferred.capability.id);
    expect(stored.operationalVersionId).toBe(preferred.operational.id);
    expect(stored.catalogVersionId).toBe(preferred.catalog.id);
    expect(stored.capacityVersionId).toBe(preferred.capacity.id);
  });

  it("prioritizes an eligible preference and deterministically falls back", async () => {
    const automatic = await createNetwork("+998000000136", 1);
    const preferred = await createNetwork("+998000000137", 999);
    const preferredOrder = await orderFor(
      preferred,
      "ALLOW_ELIGIBLE_ALTERNATIVE",
    );
    await matching.startOrder(
      preferredOrder.id,
      hash(`preferred:${preferredOrder.id}`),
    );
    const firstOffer = await prisma.partnerOffer.findFirstOrThrow({
      where: { orderId: preferredOrder.id },
    });
    expect(firstOffer.branchId).toBe(preferred.branch.id);
    const evaluation =
      await prisma.matchingCandidateEvaluation.findFirstOrThrow({
        where: {
          matching: { orderId: preferredOrder.id },
          branchId: preferred.branch.id,
        },
      });
    expect(evaluation.reasonCodes).toContain("CUSTOMER_PREFERRED");

    const fallbackOrder = await orderFor(
      preferred,
      "ALLOW_ELIGIBLE_ALTERNATIVE",
    );
    await prisma.branch.update({
      where: { id: preferred.branch.id },
      data: { acceptingOrders: false },
    });
    await matching.startOrder(
      fallbackOrder.id,
      hash(`fallback:${fallbackOrder.id}`),
    );
    const fallback = await prisma.partnerOffer.findFirstOrThrow({
      where: { orderId: fallbackOrder.id },
    });
    expect(fallback.branchId).toBe(automatic.branch.id);
  });

  it("uses the single refund path for strict unavailability and keeps snapshots immutable", async () => {
    const strict = await createNetwork("+998000000138", 700);
    const order = await orderFor(strict, "STRICT_PREFERENCE");
    await prisma.branch.update({
      where: { id: strict.branch.id },
      data: { acceptingOrders: false },
    });
    await matching.startOrder(order.id, hash(`strict:${order.id}`));
    expect(
      await prisma.partnerOffer.count({ where: { orderId: order.id } }),
    ).toBe(0);
    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: order.id, eventType: "MATCHING_EXHAUSTED" },
    });
    const job = {
      data: {
        eventType: "MATCHING_EXHAUSTED",
        aggregateId: order.id,
        dedupKey: event.dedupKey,
      },
    };
    await matchingQueue.handle(job as never);
    await matchingQueue.handle(job as never);
    expect(
      await prisma.refundOperation.count({
        where: { payment: { orderId: order.id } },
      }),
    ).toBe(1);
    const snapshot =
      await prisma.orderStudioSelectionSnapshot.findUniqueOrThrow({
        where: { orderId: order.id },
      });
    await expect(
      prisma.orderStudioSelectionSnapshot.update({
        where: { id: snapshot.id },
        data: { fallbackPolicy: "ALLOW_ELIGIBLE_ALTERNATIVE" },
      }),
    ).rejects.toThrow();
    const audit = await prisma.auditEvent.findMany({
      where: { eventType: { startsWith: "STUDIO_" } },
    });
    expect(JSON.stringify(audit)).not.toMatch(
      /description|publicSlug|phone|coordinate|objectKey|signed/i,
    );
  });
});
