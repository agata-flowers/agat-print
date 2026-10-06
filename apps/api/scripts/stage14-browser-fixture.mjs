import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const optionSchema = {
  fields: [
    ["WIDTH_MM", "210"],
    ["HEIGHT_MM", "297"],
    ["MIN_DPI", "300"],
    ["PAPER", "STANDARD"],
    ["COLOR", "COLOR"],
    ["PHOTO_DOCUMENT", "NO"],
  ].map(([code, value]) => ({
    code,
    labelRu: code,
    labelUz: code,
    required: true,
    values: [{ code: value, labelRu: value, labelUz: value }],
  })),
};

async function main() {
  const publisher = await prisma.user.upsert({
    where: { phone: "+998000000199" },
    update: {},
    create: { phone: "+998000000199", locale: "ru" },
  });
  const [catalogAggregate, tariffAggregate] = await Promise.all([
    prisma.platformCatalogVersion.aggregate({ _max: { version: true } }),
    prisma.tariffVersion.aggregate({ _max: { version: true } }),
  ]);

  await prisma.$transaction([
    prisma.platformCatalogVersion.create({
      data: {
        version: (catalogAggregate._max.version ?? 0) + 1,
        status: "ACTIVE",
        createdById: publisher.id,
        publishedAt: new Date(),
        items: {
          create: {
            serviceCode: "DOCUMENT_PRINT",
            slug: "document-print",
            titleRu: "Печать документов",
            titleUz: "Hujjat chop etish",
            descriptionRu: "Печать PDF и DOCX",
            descriptionUz: "PDF va DOCX chop etish",
            acceptedFileKinds: ["PDF", "DOCX", "JPEG", "PNG"],
            optionSchema,
            sortOrder: 10,
          },
        },
      },
    }),
    prisma.tariffVersion.create({
      data: {
        version: (tariffAggregate._max.version ?? 0) + 1,
        status: "ACTIVE",
        currency: "UZS",
        basePriceMinor: 1_000n,
        perPagePriceMinor: 250n,
        createdById: publisher.id,
        rules: {
          create: {
            serviceCode: "DOCUMENT_PRINT",
            basePriceMinor: 1_000n,
            perPagePriceMinor: 250n,
            optionPrices: {},
          },
        },
        fulfillmentRules: {
          create: [
            {
              mode: "PICKUP",
              locationCode: "PICKUP",
              feeMinor: 0n,
            },
            {
              mode: "DELIVERY",
              locationCode: "TASHKENT",
              feeMinor: 12_000n,
            },
          ],
        },
      },
    }),
  ]);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
