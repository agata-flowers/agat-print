import "reflect-metadata";
import "./test-environment";
import { createHash, randomUUID } from "node:crypto";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { NotificationWorkerService } from "../src/ordering/notification-worker.service";
import { PrismaService } from "../src/prisma/prisma.service";

const enabled = process.env.RUN_STAGE11_E2E === "1";
const origin = "http://localhost:3000";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const opaque = (prefix: string) =>
  `${prefix}/${randomUUID().replaceAll("-", "").padEnd(64, "0")}`;
const schema = {
  fields: [
    {
      code: "WIDTH_MM",
      labelRu: "Ширина",
      labelUz: "Kenglik",
      required: true,
      values: [{ code: "210", labelRu: "210 мм", labelUz: "210 mm" }],
    },
    {
      code: "HEIGHT_MM",
      labelRu: "Высота",
      labelUz: "Balandlik",
      required: true,
      values: [{ code: "297", labelRu: "297 мм", labelUz: "297 mm" }],
    },
    {
      code: "MIN_DPI",
      labelRu: "Качество",
      labelUz: "Sifat",
      required: true,
      values: [{ code: "300", labelRu: "Стандарт", labelUz: "Standart" }],
    },
    {
      code: "PAPER",
      labelRu: "Бумага",
      labelUz: "Qog‘oz",
      required: true,
      values: [{ code: "STANDARD", labelRu: "Обычная", labelUz: "Oddiy" }],
    },
    {
      code: "COLOR",
      labelRu: "Цвет",
      labelUz: "Rang",
      required: true,
      values: [{ code: "COLOR", labelRu: "Цветная", labelUz: "Rangli" }],
    },
    {
      code: "PHOTO_DOCUMENT",
      labelRu: "Фото на документы",
      labelUz: "Hujjat uchun foto",
      required: true,
      values: [{ code: "NO", labelRu: "Нет", labelUz: "Yo‘q" }],
    },
  ],
};
const configuration = {
  WIDTH_MM: "210",
  HEIGHT_MM: "297",
  MIN_DPI: "300",
  PAPER: "STANDARD",
  COLOR: "COLOR",
  PHOTO_DOCUMENT: "NO",
};

describe.skipIf(!enabled)("stage 11 customer ordering DB-E2E", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let notifications: NotificationWorkerService;
  let customer: Awaited<ReturnType<typeof login>>;
  let other: Awaited<ReturnType<typeof login>>;
  let admin: Awaited<ReturnType<typeof login>>;

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
    notifications = app.get(NotificationWorkerService);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    customer = await login("+998000000111");
    other = await login("+998000000112");
    admin = await login("+998000000113");
    await prisma.userRole.create({
      data: { userId: admin.userId, role: "ADMIN" },
    });
    admin.csrf = await refresh(admin);
    await publishCatalog();
    await admin.agent
      .post("/api/v1/admin/tariffs")
      .set("Origin", origin)
      .set("X-CSRF-Token", admin.csrf)
      .send({
        basePriceMinor: "1000",
        perPagePriceMinor: "250",
        rules: ["DOCUMENT_PRINT", "PHOTO_PRINT", "ID_PHOTO"].map(
          (serviceCode) => ({
            serviceCode,
            basePriceMinor: "1000",
            perPagePriceMinor: "250",
            optionPrices: { "COLOR=COLOR": "500" },
          }),
        ),
      })
      .expect(201);
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
    session: typeof customer,
    path: string,
    body: object,
    key = randomUUID(),
  ) =>
    session.agent
      .post(`/api/v1${path}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", session.csrf)
      .set("Idempotency-Key", key)
      .send(body);

  async function publishCatalog() {
    return mutate(admin, "/admin/catalog/versions", {
      items: [
        {
          serviceCode: "DOCUMENT_PRINT",
          slug: "document-print",
          titleRu: "Печать документов",
          titleUz: "Hujjatlarni chop etish",
          descriptionRu: "PDF и DOCX",
          descriptionUz: "PDF va DOCX",
          acceptedFileKinds: ["PDF", "DOCX"],
          optionSchema: schema,
          sortOrder: 10,
        },
        {
          serviceCode: "PHOTO_PRINT",
          slug: "photo-print",
          titleRu: "Печать фотографий",
          titleUz: "Fotosurat chop etish",
          descriptionRu: "JPG и PNG",
          descriptionUz: "JPG va PNG",
          acceptedFileKinds: ["JPEG", "PNG"],
          optionSchema: schema,
          sortOrder: 20,
        },
        {
          serviceCode: "ID_PHOTO",
          slug: "id-photo",
          titleRu: "Фото на документы",
          titleUz: "Hujjat uchun foto",
          descriptionRu: "Фото стандартного размера",
          descriptionUz: "Standart o‘lchamdagi foto",
          acceptedFileKinds: ["JPEG", "PNG"],
          optionSchema: schema,
          sortOrder: 30,
        },
      ],
    }).expect(201);
  }

  async function processedFixture(kind: "PDF" | "DOCX" | "JPEG" | "PNG") {
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
        settings: configuration,
        status: "AWAITING_APPROVAL",
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
    await prisma.layoutRequest.update({
      where: { id: layout.id },
      data: { latestPreviewId: preview.id, latestPrintReadyId: printReady.id },
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
      data: { status: "APPROVED", currentApprovalId: approval.id, version: 1 },
    });
    return { upload, layout };
  }

  async function customerCheckout(
    kind: "PDF" | "DOCX" | "JPEG" | "PNG",
    serviceSlug: string,
  ) {
    const created = await mutate(customer, "/order-drafts", {
      serviceSlug,
      locale: "ru",
      configuration,
      quantity: 2,
    }).expect(201);
    const id = created.body.id as string;
    const fixture = await processedFixture(kind);
    const linkedUpload = await mutate(customer, `/order-drafts/${id}/upload`, {
      version: 0,
      resourceId: fixture.upload.id,
    }).expect(201);
    await mutate(customer, `/order-drafts/${id}/layout`, {
      version: linkedUpload.body.version,
      resourceId: fixture.layout.id,
    }).expect(201);
    const synced = await mutate(customer, `/order-drafts/${id}/sync`, {
      version: 2,
    }).expect(201);
    const quoted = await mutate(customer, `/order-drafts/${id}/quote`, {
      version: synced.body.version,
    }).expect(201);
    const checkoutKey = randomUUID();
    const checkout = await mutate(
      customer,
      `/order-drafts/${id}/checkout`,
      {
        version: quoted.body.draftVersion,
      },
      checkoutKey,
    ).expect(201);
    return {
      id,
      orderId: checkout.body.id as string,
      quoteId: quoted.body.id as string,
      draftVersion: quoted.body.draftVersion as number,
      checkoutKey,
    };
  }

  it("carries PDF, DOCX, JPEG and PNG through the authoritative customer checkout", async () => {
    const cases = [
      ["PDF", "document-print"],
      ["DOCX", "document-print"],
      ["JPEG", "photo-print"],
      ["PNG", "id-photo"],
    ] as const;
    for (const [kind, service] of cases) {
      const result = await customerCheckout(kind, service);
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: result.orderId },
        include: { priceSnapshot: true, priceQuote: true },
      });
      expect(order.status).toBe("AWAITING_PAYMENT");
      expect(order.priceSnapshot?.currency).toBe("UZS");
      expect(order.priceSnapshot?.totalMinor).toBe(3_000n);
      expect(order.priceQuote?.status).toBe("CONSUMED");
    }
  }, 30_000);

  it("enforces ownership, idempotency payload hashes and immutable quote content", async () => {
    const key = randomUUID();
    const payload = {
      serviceSlug: "document-print",
      locale: "ru",
      configuration,
      quantity: 1,
    };
    const first = await mutate(customer, "/order-drafts", payload, key).expect(
      201,
    );
    expect(
      (await mutate(customer, "/order-drafts", payload, key).expect(201)).body
        .id,
    ).toBe(first.body.id);
    await mutate(
      customer,
      "/order-drafts",
      { ...payload, quantity: 2 },
      key,
    ).expect(409);
    await other.agent.get(`/api/v1/order-drafts/${first.body.id}`).expect(404);

    const checkedOut = await customerCheckout("PDF", "document-print");
    const replay = await mutate(
      customer,
      `/order-drafts/${checkedOut.id}/checkout`,
      { version: checkedOut.draftVersion },
      checkedOut.checkoutKey,
    ).expect(201);
    expect(replay.body.id).toBe(checkedOut.orderId);
    await mutate(
      customer,
      `/order-drafts/${checkedOut.id}/checkout`,
      { version: checkedOut.draftVersion },
      randomUUID(),
    ).expect(409);
    expect(
      await prisma.order.count({ where: { orderDraftId: checkedOut.id } }),
    ).toBe(1);
    await expect(
      prisma.priceQuote.update({
        where: { id: checkedOut.quoteId },
        data: { totalMinor: 1n },
      }),
    ).rejects.toThrow();
  });

  it("allows only one checkout under concurrent requests", async () => {
    const created = await mutate(customer, "/order-drafts", {
      serviceSlug: "document-print",
      locale: "ru",
      configuration,
      quantity: 1,
    }).expect(201);
    const fixture = await processedFixture("PDF");
    await mutate(customer, `/order-drafts/${created.body.id}/upload`, {
      version: 0,
      resourceId: fixture.upload.id,
    }).expect(201);
    await mutate(customer, `/order-drafts/${created.body.id}/layout`, {
      version: 1,
      resourceId: fixture.layout.id,
    }).expect(201);
    const synced = await mutate(
      customer,
      `/order-drafts/${created.body.id}/sync`,
      { version: 2 },
    ).expect(201);
    const quoted = await mutate(
      customer,
      `/order-drafts/${created.body.id}/quote`,
      { version: synced.body.version },
    ).expect(201);
    const results = await Promise.all([
      mutate(
        customer,
        `/order-drafts/${created.body.id}/checkout`,
        { version: quoted.body.draftVersion },
        randomUUID(),
      ),
      mutate(
        customer,
        `/order-drafts/${created.body.id}/checkout`,
        { version: quoted.body.draftVersion },
        randomUUID(),
      ),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.order.count({ where: { orderDraftId: created.body.id } }),
    ).toBe(1);
  });

  it("rejects stale catalog/quote and delivers each customer event once", async () => {
    const created = await mutate(customer, "/order-drafts", {
      serviceSlug: "document-print",
      locale: "uz",
      configuration,
      quantity: 1,
    }).expect(201);
    const fixture = await processedFixture("PDF");
    const linked = await mutate(
      customer,
      `/order-drafts/${created.body.id}/upload`,
      { version: 0, resourceId: fixture.upload.id },
    ).expect(201);
    await mutate(customer, `/order-drafts/${created.body.id}/layout`, {
      version: linked.body.version,
      resourceId: fixture.layout.id,
    }).expect(201);
    const synced = await mutate(
      customer,
      `/order-drafts/${created.body.id}/sync`,
      { version: 2 },
    ).expect(201);
    const quoted = await mutate(
      customer,
      `/order-drafts/${created.body.id}/quote`,
      { version: synced.body.version },
    ).expect(201);
    await publishCatalog();
    await mutate(customer, `/order-drafts/${created.body.id}/checkout`, {
      version: quoted.body.draftVersion,
    }).expect(409);

    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: "ORDER_CREATED" },
      orderBy: { createdAt: "asc" },
    });
    const dedupKey = hash(`customer-notification:${event.dedupKey}`);
    await prisma.notificationJob.create({
      data: { outboxEventId: event.id, dedupKey },
    });
    expect(await notifications.handle(dedupKey)).toEqual({ delivered: true });
    expect(await notifications.handle(dedupKey)).toEqual({ duplicate: true });
    expect(
      await prisma.userNotification.count({
        where: { outboxEventId: event.id },
      }),
    ).toBe(1);
    expect(
      await prisma.customerOrderEvent.count({
        where: { outboxEventId: event.id },
      }),
    ).toBe(1);

    const activeCatalog = await prisma.platformCatalogVersion.findFirstOrThrow({
      where: { status: "ACTIVE" },
      include: { items: true },
    });
    const expired = await prisma.orderDraft.create({
      data: {
        userId: customer.userId,
        catalogVersionId: activeCatalog.id,
        catalogItemId: activeCatalog.items[0]!.id,
        serviceCode: activeCatalog.items[0]!.serviceCode,
        locale: "ru",
        configuration,
        quantity: 1,
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    expect(await notifications.expireStaleDrafts()).toBe(1);
    expect(
      (await prisma.orderDraft.findUniqueOrThrow({ where: { id: expired.id } }))
        .status,
    ).toBe("EXPIRED");
  });
});
