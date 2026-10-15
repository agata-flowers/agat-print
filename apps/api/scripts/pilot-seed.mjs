import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const pilot = {
  customerPhone: "+998000016101",
  partnerPhone: "+998000016102",
  adminPhone: "+998000016103",
  branchName: "AGAT PRINT Pilot Studio",
  publicSlug: "agat-print-pilot-studio",
};

const optionSchema = {
  fields: [
    {
      code: "PAPER",
      labelRu: "Бумага",
      labelUz: "Qog‘oz",
      labelEn: "Paper",
      required: true,
      values: [
        {
          code: "STANDARD",
          labelRu: "Стандартная",
          labelUz: "Standart",
          labelEn: "Standard",
        },
      ],
    },
    {
      code: "COLOR",
      labelRu: "Цветность",
      labelUz: "Rang",
      labelEn: "Colour",
      required: true,
      values: [
        {
          code: "COLOR",
          labelRu: "Цветная",
          labelUz: "Rangli",
          labelEn: "Colour",
        },
        {
          code: "MONOCHROME",
          labelRu: "Чёрно-белая",
          labelUz: "Oq-qora",
          labelEn: "Monochrome",
        },
      ],
    },
  ],
};

const services = [
  {
    serviceCode: "DOCUMENT_PRINT",
    slug: "document-print",
    titleRu: "Печать документов",
    titleUz: "Hujjatlarni chop etish",
    titleEn: "Document printing",
    descriptionRu: "Безопасная печать PDF и DOCX",
    descriptionUz: "PDF va DOCX fayllarini xavfsiz chop etish",
    descriptionEn: "Secure PDF and DOCX printing",
    acceptedFileKinds: ["PDF", "DOCX"],
    sortOrder: 10,
  },
  {
    serviceCode: "PHOTO_PRINT",
    slug: "photo-print",
    titleRu: "Печать фотографий",
    titleUz: "Fotosuratlarni chop etish",
    titleEn: "Photo printing",
    descriptionRu: "Печать JPG/JPEG и PNG",
    descriptionUz: "JPG/JPEG va PNG fayllarini chop etish",
    descriptionEn: "Print JPG/JPEG and PNG photos",
    acceptedFileKinds: ["JPEG", "PNG"],
    sortOrder: 20,
  },
  {
    serviceCode: "ID_PHOTO",
    slug: "id-photo",
    titleRu: "Фото на документы",
    titleUz: "Hujjat uchun foto",
    titleEn: "ID photo",
    descriptionRu: "Подготовка фото с проверкой качества",
    descriptionUz: "Sifat tekshiruvi bilan surat tayyorlash",
    descriptionEn: "Prepare a photo with quality checks",
    acceptedFileKinds: ["JPEG", "PNG"],
    sortOrder: 30,
  },
];

async function ensureCatalog(authorId) {
  const current = await prisma.platformCatalogVersion.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { version: "desc" },
    include: { items: true },
  });
  const usable = services.every((service) =>
    current?.items.some(
      (item) =>
        item.serviceCode === service.serviceCode &&
        item.titleEn &&
        item.descriptionEn,
    ),
  );
  if (usable) return;
  const aggregate = await prisma.platformCatalogVersion.aggregate({
    _max: { version: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.platformCatalogVersion.updateMany({
      where: { status: "ACTIVE" },
      data: { status: "RETIRED", retiredAt: new Date() },
    });
    await tx.platformCatalogVersion.create({
      data: {
        version: (aggregate._max.version ?? 0) + 1,
        status: "ACTIVE",
        createdById: authorId,
        publishedAt: new Date(),
        items: {
          create: services.map((service) => ({
            ...service,
            optionSchema,
          })),
        },
      },
    });
  });
}

async function ensureTariff(authorId) {
  const current = await prisma.tariffVersion.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { version: "desc" },
    include: { rules: true, fulfillmentRules: true },
  });
  const usable = services.every((service) =>
    current?.rules.some((rule) => rule.serviceCode === service.serviceCode),
  );
  if (usable && current?.fulfillmentRules.length) return;
  const aggregate = await prisma.tariffVersion.aggregate({
    _max: { version: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.tariffVersion.updateMany({
      where: { status: "ACTIVE" },
      data: { status: "RETIRED" },
    });
    await tx.tariffVersion.create({
      data: {
        version: (aggregate._max.version ?? 0) + 1,
        status: "ACTIVE",
        currency: "UZS",
        basePriceMinor: 1_000n,
        perPagePriceMinor: 250n,
        createdById: authorId,
        rules: {
          create: services.map((service) => ({
            serviceCode: service.serviceCode,
            basePriceMinor:
              service.serviceCode === "ID_PHOTO" ? 20_000n : 1_000n,
            perPagePriceMinor: service.serviceCode === "ID_PHOTO" ? 0n : 250n,
            optionPrices: {},
          })),
        },
        fulfillmentRules: {
          create: [
            { mode: "PICKUP", locationCode: "PICKUP", feeMinor: 0n },
            {
              mode: "DELIVERY",
              locationCode: "TASHKENT_CENTRAL",
              feeMinor: 12_000n,
            },
          ],
        },
      },
    });
  });
}

async function ensureNetwork(ownerId, adminId) {
  const partner = await prisma.partner.upsert({
    where: { ownerId },
    update: {
      displayName: pilot.branchName,
      publicDescription: "AGAT PRINT synthetic functional pilot studio",
      status: "ACTIVE",
      approvedAt: new Date(),
    },
    create: {
      ownerId,
      displayName: pilot.branchName,
      publicDescription: "AGAT PRINT synthetic functional pilot studio",
      status: "ACTIVE",
      approvedAt: new Date(),
    },
  });
  let branch = await prisma.branch.findFirst({
    where: { partnerId: partner.id, name: pilot.branchName },
  });
  branch = branch
    ? await prisma.branch.update({
        where: { id: branch.id },
        data: {
          active: true,
          acceptingOrders: true,
          locationCode: "TASHKENT_CENTRAL",
          district: "Chilanzar",
          serviceRadiusMeters: 50_000,
        },
      })
    : await prisma.branch.create({
        data: {
          partnerId: partner.id,
          name: pilot.branchName,
          city: "Tashkent",
          district: "Chilanzar",
          locationCode: "TASHKENT_CENTRAL",
          publicDescription: "Synthetic functional pilot branch",
          latitude: 41.2756,
          longitude: 69.2034,
          serviceRadiusMeters: 50_000,
          acceptingOrders: true,
          active: true,
        },
      });

  const [capability, operation, catalog, capacity, listing] = await Promise.all(
    [
      prisma.branchCapabilityVersion.findFirst({
        where: { branchId: branch.id, status: "ACTIVE" },
      }),
      prisma.branchOperationalVersion.findFirst({
        where: { branchId: branch.id, status: "ACTIVE" },
      }),
      prisma.branchCatalogVersion.findFirst({
        where: { branchId: branch.id, status: "ACTIVE" },
      }),
      prisma.branchCapacityVersion.findFirst({
        where: { branchId: branch.id, status: "ACTIVE" },
      }),
      prisma.studioListingVersion.findFirst({
        where: { publicSlug: pilot.publicSlug, status: "PUBLISHED" },
      }),
    ],
  );

  await prisma.$transaction(async (tx) => {
    if (!capability)
      await tx.branchCapabilityVersion.create({
        data: {
          branchId: branch.id,
          version: 1,
          supportedFileKinds: ["PDF", "DOCX", "JPEG", "PNG"],
          maxPages: 100,
          maxWidthMm: 1000,
          maxHeightMm: 1000,
          minDpi: 300,
          priority: 1,
          serviceCodes: services.map((service) => service.serviceCode),
          paperCodes: ["STANDARD"],
          colorModes: ["COLOR", "MONOCHROME"],
          equipmentCodes: ["PILOT_PRINTER"],
          maxQuantity: 1000,
          createdById: ownerId,
        },
      });
    if (!operation)
      await tx.branchOperationalVersion.create({
        data: {
          branchId: branch.id,
          version: 1,
          weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            opensMinute: 0,
            closesMinute: 1440,
          })),
          settings: { pickupEnabled: true, printerAgentEnabled: false },
          createdById: ownerId,
        },
      });
    if (!catalog)
      await tx.branchCatalogVersion.create({
        data: {
          branchId: branch.id,
          version: 1,
          createdById: ownerId,
          items: {
            create: services.map((service) => ({
              serviceCode: service.serviceCode,
              enabled: true,
              paperCodes: ["STANDARD"],
              colorModes: ["COLOR", "MONOCHROME"],
              maxQuantity: 1000,
            })),
          },
        },
      });
    if (!capacity)
      await tx.branchCapacityVersion.create({
        data: {
          branchId: branch.id,
          version: 1,
          maxConcurrentOrders: 20,
          createdById: ownerId,
        },
      });
    if (!listing)
      await tx.studioListingVersion.create({
        data: {
          branchId: branch.id,
          sequence: 1,
          publicSlug: pilot.publicSlug,
          status: "PUBLISHED",
          titleRu: pilot.branchName,
          titleUz: pilot.branchName,
          descriptionRu: "Синтетическая студия для локальной проверки",
          descriptionUz: "Mahalliy tekshiruv uchun sintetik studiya",
          createdById: ownerId,
          moderatedById: adminId,
          moderationCode: "PILOT_APPROVED",
          submittedAt: new Date(),
          publishedAt: new Date(),
        },
      });
  });
}

async function main() {
  if (!new Set(["development", "test"]).has(process.env.NODE_ENV ?? ""))
    throw new Error("PILOT_SEED_DEVELOPMENT_ONLY");
  if (
    process.env.OTP_PROVIDER !== "mock" ||
    process.env.PAYMENT_PROVIDER !== "mock"
  )
    throw new Error("PILOT_SEED_REQUIRES_MOCK_PROVIDERS");

  const [customer, owner, admin] = await Promise.all(
    [
      [pilot.customerPhone, "ru", "Synthetic Customer"],
      [pilot.partnerPhone, "ru", "Synthetic Studio Operator"],
      [pilot.adminPhone, "ru", "Synthetic Pilot Admin"],
    ].map(([phone, locale, displayName]) =>
      prisma.user.upsert({
        where: { phone },
        update: { locale, displayName },
        create: { phone, locale, displayName },
      }),
    ),
  );
  await Promise.all([
    prisma.userRole.upsert({
      where: { userId_role: { userId: customer.id, role: "CUSTOMER" } },
      update: {},
      create: { userId: customer.id, role: "CUSTOMER" },
    }),
    prisma.userRole.upsert({
      where: { userId_role: { userId: owner.id, role: "PARTNER" } },
      update: {},
      create: { userId: owner.id, role: "PARTNER" },
    }),
    prisma.userRole.upsert({
      where: { userId_role: { userId: admin.id, role: "ADMIN" } },
      update: {},
      create: { userId: admin.id, role: "ADMIN" },
    }),
  ]);
  await ensureCatalog(admin.id);
  await ensureTariff(admin.id);
  await ensureNetwork(owner.id, admin.id);
  process.stdout.write("Functional pilot seed is ready.\n");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
