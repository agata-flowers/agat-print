import "reflect-metadata";
import "./test-environment";
import { createHash, randomUUID } from "node:crypto";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { FulfillmentService } from "../src/fulfillment/fulfillment.service";
import { MatchingService } from "../src/matching/matching.service";
import { PrismaService } from "../src/prisma/prisma.service";

const enabled = process.env.RUN_STAGE15_E2E === "1";
const origin = "http://localhost:3000";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const objectKey = (prefix: string) =>
  `${prefix}/${randomUUID().replaceAll("-", "")}`;

describe.skipIf(!enabled)("stage 15 multi-item basket DB-E2E", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let matching: MatchingService;
  let fulfillment: FulfillmentService;
  let customer: Awaited<ReturnType<typeof login>>;
  let stranger: Awaited<ReturnType<typeof login>>;
  let catalogId: string;
  let firstOrderId: string;
  const catalogItems = new Map<string, string>();

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
    fulfillment = app.get(FulfillmentService);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    customer = await login("+998000001501");
    stranger = await login("+998000001502");
    const catalog = await prisma.platformCatalogVersion.create({
      data: {
        version: 1,
        status: "ACTIVE",
        createdById: customer.userId,
        publishedAt: new Date(),
      },
    });
    catalogId = catalog.id;
    for (const [serviceCode, kinds] of [
      ["DOCUMENT_PRINT", ["PDF", "DOCX"]],
      ["PHOTO_PRINT", ["JPEG", "PNG"]],
    ] as const) {
      const item = await prisma.platformCatalogItem.create({
        data: {
          catalogVersionId: catalog.id,
          serviceCode,
          slug: serviceCode.toLowerCase().replaceAll("_", "-"),
          titleRu: serviceCode,
          titleUz: serviceCode,
          titleEn: serviceCode,
          descriptionRu: "Synthetic",
          descriptionUz: "Synthetic",
          descriptionEn: "Synthetic",
          acceptedFileKinds: [...kinds],
          optionSchema: { fields: [] },
        },
      });
      catalogItems.set(serviceCode, item.id);
    }
    await prisma.tariffVersion.create({
      data: {
        version: 1,
        status: "ACTIVE",
        currency: "UZS",
        basePriceMinor: 1000n,
        perPagePriceMinor: 100n,
        createdById: customer.userId,
        rules: {
          create: ["DOCUMENT_PRINT", "PHOTO_PRINT"].map((serviceCode) => ({
            serviceCode,
            basePriceMinor: 1000n,
            perPagePriceMinor: 100n,
            optionPrices: {},
          })),
        },
        fulfillmentRules: {
          create: [
            { mode: "PICKUP", locationCode: "PICKUP", feeMinor: 0n },
            {
              mode: "DELIVERY",
              locationCode: "TASHKENT_CENTRAL",
              feeMinor: 1500n,
            },
          ],
        },
      },
    });
  });

  afterAll(async () => app.close());

  async function login(phone: string) {
    const agent = request.agent(app.getHttpServer());
    const csrf = (await agent.get("/api/v1/auth/csrf").expect(200)).body
      .csrfToken as string;
    await agent
      .post("/api/v1/auth/otp/request")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({ phone })
      .expect(202);
    const verified = await agent
      .post("/api/v1/auth/otp/verify")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({ phone, code: "000000", locale: "en" })
      .expect(201);
    return {
      agent,
      csrf: verified.body.csrfToken as string,
      userId: verified.body.user.id as string,
    };
  }

  const command = (
    session: typeof customer,
    method: "post" | "put" | "patch" | "delete",
    path: string,
    body: object,
    idempotencyKey = randomUUID(),
  ) =>
    session.agent[method](`/api/v1${path}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", session.csrf)
      .set("Idempotency-Key", idempotencyKey)
      .send(body);

  async function activePartner() {
    const session = await login("+998000001503");
    const partner = await prisma.partner.create({
      data: {
        ownerId: session.userId,
        displayName: "Synthetic all-item studio",
        status: "ACTIVE",
        approvedAt: new Date(),
        branches: {
          create: {
            name: "Synthetic branch",
            locationCode: "TASHKENT_CENTRAL",
          },
        },
      },
      include: { branches: true },
    });
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
    const branch = partner.branches[0]!;
    await prisma.branchCapabilityVersion.create({
      data: {
        branchId: branch.id,
        version: 1,
        supportedFileKinds: ["PDF", "DOCX", "JPEG", "PNG"],
        maxPages: 100,
        maxWidthMm: 1000,
        maxHeightMm: 1000,
        minDpi: 300,
        priority: 1,
        serviceCodes: ["DOCUMENT_PRINT", "PHOTO_PRINT"],
        paperCodes: ["STANDARD"],
        colorModes: ["COLOR"],
        equipmentCodes: [],
        maxQuantity: 100,
        createdById: session.userId,
      },
    });
    await prisma.branchOperationalVersion.create({
      data: {
        branchId: branch.id,
        version: 1,
        weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          opensMinute: 0,
          closesMinute: 1440,
        })),
        settings: { pickupEnabled: true, printerAgentEnabled: true },
        createdById: session.userId,
      },
    });
    await prisma.branchCatalogVersion.create({
      data: {
        branchId: branch.id,
        version: 1,
        createdById: session.userId,
        items: {
          create: ["DOCUMENT_PRINT", "PHOTO_PRINT"].map((serviceCode) => ({
            serviceCode,
            enabled: true,
            paperCodes: ["STANDARD"],
            colorModes: ["COLOR"],
            maxQuantity: 100,
          })),
        },
      },
    });
    await prisma.branchCapacityVersion.create({
      data: {
        branchId: branch.id,
        version: 1,
        maxConcurrentOrders: 5,
        createdById: session.userId,
      },
    });
    return { ...session, partner, branch };
  }

  async function approvedDraft(kind: "PDF" | "DOCX" | "JPEG" | "PNG") {
    const serviceCode =
      kind === "PDF" || kind === "DOCX" ? "DOCUMENT_PRINT" : "PHOTO_PRINT";
    const upload = await prisma.uploadSession.create({
      data: {
        userId: customer.userId,
        fileKind: kind,
        declaredMime:
          kind === "PDF"
            ? "application/pdf"
            : kind === "DOCX"
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : kind === "PNG"
                ? "image/png"
                : "image/jpeg",
        expectedSizeBytes: 100n,
        actualSizeBytes: 100n,
        sha256: hash(randomUUID()),
        status: "READY",
        quarantineObjectKey: objectKey("quarantine"),
        permanentObjectKey: objectKey("original"),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const job = await prisma.processingJob.create({
      data: {
        uploadId: upload.id,
        operation: "NORMALIZE",
        settingsHash: hash(randomUUID()),
        dedupKey: hash(randomUUID()),
        resultObjectKey: objectKey("result"),
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
          serviceCode,
          paperCode: "STANDARD",
          colorMode: "COLOR",
          targetWidthMm: 210,
          targetHeightMm: 297,
          minDpi: 300,
        },
        status: "AWAITING_APPROVAL",
      },
    });
    const preview = await prisma.previewVersion.create({
      data: {
        layoutId: layout.id,
        version: 1,
        objectKey: objectKey("preview"),
        checksum: hash(randomUUID()),
        sizeBytes: 100n,
        sourceFileVersion: upload.fileVersion,
        settingsHash,
        originProcessingResultId: result.id,
        pageCount: 2,
      },
    });
    const ready = await prisma.printReadyVersion.create({
      data: {
        layoutId: layout.id,
        version: 1,
        objectKey: objectKey("ready"),
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
        status: "APPROVED",
        version: 1,
        latestPreviewId: preview.id,
        latestPrintReadyId: ready.id,
        currentApprovalId: approval.id,
      },
    });
    return prisma.orderDraft.create({
      data: {
        userId: customer.userId,
        catalogVersionId: catalogId,
        catalogItemId: catalogItems.get(serviceCode)!,
        serviceCode,
        locale: "en",
        configuration: { paperCode: "STANDARD", colorMode: "COLOR" },
        quantity: 1,
        status: "READY_FOR_QUOTE",
        uploadId: upload.id,
        layoutId: layout.id,
        layoutApprovalId: approval.id,
        fulfillmentRequired: true,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
  }

  async function createBasket(drafts: Array<{ id: string }>) {
    let basket = (
      await command(customer, "post", "/baskets", { locale: "en" }).expect(201)
    ).body;
    for (const draft of drafts)
      basket = (
        await command(customer, "post", `/baskets/${basket.id}/items`, {
          version: basket.version,
          draftId: draft.id,
        }).expect(201)
      ).body;
    basket = (
      await command(
        customer,
        "put",
        `/baskets/${basket.id}/studio-preference`,
        {
          version: basket.version,
          mode: "AUTO_ASSIGN",
          fallbackPolicy: "ALLOW_ELIGIBLE_ALTERNATIVE",
        },
      ).expect(200)
    ).body;
    basket = (
      await command(
        customer,
        "put",
        `/baskets/${basket.id}/fulfillment-preference`,
        { version: basket.version, mode: "PICKUP", locationCode: "PICKUP" },
      ).expect(200)
    ).body;
    return basket;
  }

  it("checks out PDF + JPEG as one authoritative order and one snapshot", async () => {
    const basket = await createBasket([
      await approvedDraft("PDF"),
      await approvedDraft("JPEG"),
    ]);
    const quote = (
      await command(customer, "post", `/baskets/${basket.id}/quote`, {
        version: basket.version,
      }).expect(201)
    ).body;
    const order = (
      await command(customer, "post", `/baskets/${basket.id}/checkout`, {
        version: quote.basketVersion,
      }).expect(201)
    ).body;
    expect(order.itemCount).toBe(2);
    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true, priceSnapshot: true, fulfillmentSelection: true },
    });
    expect(stored.items.map((item) => item.sequence)).toEqual([1, 2]);
    expect(stored.priceSnapshot?.totalMinor.toString()).toBe(order.totalMinor);
    expect(stored.fulfillmentSelection?.mode).toBe("PICKUP");
    firstOrderId = order.id;
  });

  it("matches one fully eligible studio and gates READY on every item job", async () => {
    const partner = await activePartner();
    await prisma.order.update({
      where: { id: firstOrderId },
      data: {
        status: "PAID",
        payment: {
          create: {
            provider: "mock",
            providerPaymentReference: hash(randomUUID()),
            amountMinor: (
              await prisma.priceSnapshot.findUniqueOrThrow({
                where: { orderId: firstOrderId },
              })
            ).totalMinor,
            currency: "UZS",
            status: "SUCCEEDED",
          },
        },
      },
    });
    await matching.startOrder(firstOrderId, hash(`stage15:${firstOrderId}`));
    const offer = await prisma.partnerOffer.findFirstOrThrow({
      where: { orderId: firstOrderId, status: "PENDING" },
      include: { capacityReservation: true, payoutSnapshot: true },
    });
    expect(offer.partnerId).toBe(partner.partner.id);
    expect(offer.capacityReservation?.demandUnits).toBe(2);
    expect(
      (offer.payoutSnapshot?.calculationInputs as { items: unknown[] }).items,
    ).toHaveLength(2);
    await command(partner, "post", `/partner/offers/${offer.id}/decision`, {
      decision: "ACCEPT",
    }).expect(201);
    expect(
      await fulfillment.createPrintJob(
        firstOrderId,
        hash(`stage15-print:${firstOrderId}`),
      ),
    ).toMatchObject({ duplicate: false, itemCount: 2 });
    expect(
      await fulfillment.createPrintJob(
        firstOrderId,
        hash(`stage15-print:${firstOrderId}`),
      ),
    ).toEqual({ duplicate: true });
    await command(
      partner,
      "post",
      `/partner/orders/${firstOrderId}/items/1/status`,
      { status: "COMPLETED" },
    ).expect(201);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: firstOrderId } }))
        .status,
    ).toBe("IN_PRODUCTION");
    await command(
      partner,
      "post",
      `/partner/orders/${firstOrderId}/items/2/status`,
      { status: "COMPLETED" },
    ).expect(201);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: firstOrderId } }))
        .status,
    ).toBe("READY");
  });

  it("supports DOCX + PNG and rejects cross-customer access", async () => {
    const basket = await createBasket([
      await approvedDraft("DOCX"),
      await approvedDraft("PNG"),
    ]);
    await stranger.agent.get(`/api/v1/baskets/${basket.id}`).expect(404);
    const result = await customer.agent
      .get(`/api/v1/baskets/${basket.id}`)
      .expect(200);
    expect(result.body.items).toHaveLength(2);
  });

  it("replays the same command and rejects changed payload for one key", async () => {
    const draft = await approvedDraft("PDF");
    const basket = (
      await command(customer, "post", "/baskets", { locale: "ru" }).expect(201)
    ).body;
    const idempotencyKey = randomUUID();
    const first = await command(
      customer,
      "post",
      `/baskets/${basket.id}/items`,
      { version: basket.version, draftId: draft.id },
      idempotencyKey,
    ).expect(201);
    const replay = await command(
      customer,
      "post",
      `/baskets/${basket.id}/items`,
      { version: basket.version, draftId: draft.id },
      idempotencyKey,
    ).expect(201);
    expect(replay.body).toEqual(first.body);
    await command(
      customer,
      "post",
      `/baskets/${basket.id}/items`,
      { version: basket.version, draftId: randomUUID() },
      idempotencyKey,
    ).expect(409);
  });

  it("allows only one winner for concurrent basket CAS", async () => {
    const firstDraft = await approvedDraft("PDF");
    const secondDraft = await approvedDraft("JPEG");
    const basket = await createBasket([firstDraft]);
    const responses = await Promise.all([
      command(customer, "post", `/baskets/${basket.id}/items`, {
        version: basket.version,
        draftId: secondDraft.id,
      }),
      command(customer, "put", `/baskets/${basket.id}/studio-preference`, {
        version: basket.version,
        mode: "AUTO_ASSIGN",
        fallbackPolicy: "ALLOW_ELIGIBLE_ALTERNATIVE",
      }),
    ]);
    expect(
      responses.filter(
        (response) => response.status >= 200 && response.status < 300,
      ),
    ).toHaveLength(1);
    expect(
      responses.filter((response) => response.status === 409),
    ).toHaveLength(1);
  });

  it("prepares three deterministic two-item browser baskets", async () => {
    for (const kinds of [
      ["PDF", "JPEG"],
      ["DOCX", "PNG"],
      ["PDF", "PNG"],
    ] as const)
      await createBasket([
        await approvedDraft(kinds[0]),
        await approvedDraft(kinds[1]),
      ]);
    const active = await prisma.orderBasket.count({
      where: { userId: customer.userId, status: "ACTIVE", items: { some: {} } },
    });
    expect(active).toBeGreaterThanOrEqual(3);
  });
});
