import "reflect-metadata";
import "./test-environment";
import { createHash, randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { OrderingService } from "../src/ordering/ordering.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { MatchingService } from "../src/matching/matching.service";
import { FulfillmentService } from "../src/fulfillment/fulfillment.service";

const enabled = process.env.RUN_STAGE13_E2E === "1";
process.env.STAGE13_FULFILLMENT_ENABLED = "true";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const opaque = (prefix: string) =>
  `${prefix}/${randomUUID().replaceAll("-", "").padEnd(64, "0")}`;
const documentPrintOptions = {
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

describe.skipIf(!enabled)("stage 13 fulfillment commitment DB-E2E", () => {
  let prisma: PrismaService;
  let ordering: OrderingService;
  let matching: MatchingService;
  let fulfillment: FulfillmentService;
  let customerId: string;
  let otherId: string;
  let catalogVersionId: string;
  let catalogItemId: string;
  let tariffId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    prisma = module.get(PrismaService);
    ordering = module.get(OrderingService);
    matching = module.get(MatchingService);
    fulfillment = module.get(FulfillmentService);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
    const [customer, other, admin] = await Promise.all([
      prisma.user.create({ data: { phone: "+998000000151" } }),
      prisma.user.create({ data: { phone: "+998000000152" } }),
      prisma.user.create({ data: { phone: "+998000000153" } }),
    ]);
    customerId = customer.id;
    otherId = other.id;
    const tariff = await prisma.tariffVersion.create({
      data: {
        version: 1,
        basePriceMinor: 1_000n,
        perPagePriceMinor: 250n,
        createdById: admin.id,
        fulfillmentRules: {
          create: [
            { mode: "PICKUP", locationCode: "PICKUP", feeMinor: 0n },
            { mode: "DELIVERY", locationCode: "TASHKENT", feeMinor: 12_000n },
          ],
        },
      },
    });
    tariffId = tariff.id;
    const catalog = await prisma.platformCatalogVersion.create({
      data: {
        version: 1,
        status: "ACTIVE",
        createdById: admin.id,
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
            optionSchema: documentPrintOptions,
          },
        },
      },
      include: { items: true },
    });
    catalogVersionId = catalog.id;
    catalogItemId = catalog.items[0]!.id;
  });

  afterAll(async () => prisma.$disconnect());

  async function approvedDraft() {
    const upload = await prisma.uploadSession.create({
      data: {
        userId: customerId,
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
    const processing = await prisma.processingJob.create({
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
        jobId: processing.id,
        uploadId: upload.id,
        objectKey: processing.resultObjectKey,
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
        settings: {},
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
    return prisma.orderDraft.create({
      data: {
        userId: customerId,
        catalogVersionId,
        catalogItemId,
        serviceCode: "DOCUMENT_PRINT",
        configuration: {},
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

  async function checkout(mode: "PICKUP" | "DELIVERY") {
    const draft = await approvedDraft();
    const address = "Synthetic district, building 10";
    const selection = (await ordering.setFulfillmentPreference(
      customerId,
      draft.id,
      randomUUID(),
      {
        version: 0,
        mode,
        locationCode: mode === "PICKUP" ? "PICKUP" : "TASHKENT",
        ...(mode === "DELIVERY" ? { address } : {}),
      },
    )) as { version: number };
    const quote = (await ordering.quote(customerId, draft.id, randomUUID(), {
      version: selection.version,
    })) as { totalMinor: string; draftVersion: number };
    const order = (await ordering.checkout(customerId, draft.id, randomUUID(), {
      version: quote.draftVersion,
    })) as {
      id: string;
      fulfillmentSelection: null | {
        mode: string;
        locationCode: string;
        feeMinor: string;
      };
    };
    return { draft, address, quote, order };
  }

  it("quotes pickup before checkout and freezes an immutable zero-fee selection", async () => {
    const result = await checkout("PICKUP");
    expect(result.quote.totalMinor).toBe("1500");
    expect(result.order.fulfillmentSelection).toMatchObject({
      mode: "PICKUP",
      locationCode: "PICKUP",
      feeMinor: "0",
    });
    const snapshot =
      await prisma.orderFulfillmentSelectionSnapshot.findUniqueOrThrow({
        where: { orderId: result.order.id },
      });
    await expect(
      prisma.orderFulfillmentSelectionSnapshot.update({
        where: { id: snapshot.id },
        data: { feeMinor: 1n },
      }),
    ).rejects.toThrow();
  });

  it("adds deterministic delivery pricing and never exposes plaintext address", async () => {
    const result = await checkout("DELIVERY");
    expect(result.quote.totalMinor).toBe("13500");
    expect(JSON.stringify(result.order)).not.toContain(result.address);
    const snapshot =
      await prisma.orderFulfillmentSelectionSnapshot.findUniqueOrThrow({
        where: { orderId: result.order.id },
      });
    expect(snapshot.addressCiphertext).toBeTruthy();
    expect(snapshot.addressCiphertext).not.toContain(result.address);
    const price = await prisma.priceSnapshot.findUniqueOrThrow({
      where: { orderId: result.order.id },
    });
    expect(price.totalMinor).toBe(13_500n);
    expect(JSON.stringify(price.lineItems)).toContain("FULFILLMENT");
  });

  it("keeps owner isolation and rejects stale/replayed selection mutations", async () => {
    const draft = await approvedDraft();
    await expect(ordering.ownDraft(otherId, draft.id)).rejects.toThrow();
    const key = randomUUID();
    const payload = {
      version: 0,
      mode: "PICKUP" as const,
      locationCode: "PICKUP",
    };
    const first = await ordering.setFulfillmentPreference(
      customerId,
      draft.id,
      key,
      payload,
    );
    const replay = await ordering.setFulfillmentPreference(
      customerId,
      draft.id,
      key,
      payload,
    );
    expect(replay).toEqual(JSON.parse(JSON.stringify(first)));
    await expect(
      ordering.setFulfillmentPreference(customerId, draft.id, key, {
        ...payload,
        mode: "DELIVERY",
        locationCode: "TASHKENT",
        address: "Synthetic address",
      }),
    ).rejects.toThrow();
    expect(
      await prisma.tariffVersion.findUnique({ where: { id: tariffId } }),
    ).toBeTruthy();
  });

  it("uses the frozen delivery zone as a hard matching eligibility guard", async () => {
    const result = await checkout("DELIVERY");
    const partnerUser = await prisma.user.create({
      data: { phone: "+998000000156" },
    });
    const partner = await prisma.partner.create({
      data: {
        ownerId: partnerUser.id,
        displayName: "Synthetic out-of-zone studio",
        status: "ACTIVE",
        approvedAt: new Date(),
        branches: {
          create: {
            name: "Synthetic branch",
            city: "Synthetic city",
            locationCode: "SAMARKAND",
          },
        },
      },
      include: { branches: true },
    });
    const branch = partner.branches[0]!;
    await prisma.branchCapabilityVersion.create({
      data: {
        branchId: branch.id,
        version: 1,
        supportedFileKinds: ["PDF"],
        maxPages: 100,
        maxWidthMm: 500,
        maxHeightMm: 500,
        minDpi: 72,
        priority: 1,
        serviceCodes: ["DOCUMENT_PRINT"],
        paperCodes: ["STANDARD"],
        colorModes: ["COLOR"],
        equipmentCodes: [],
        maxQuantity: 100,
        createdById: partnerUser.id,
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
        settings: {},
        createdById: partnerUser.id,
      },
    });
    await prisma.branchCatalogVersion.create({
      data: {
        branchId: branch.id,
        version: 1,
        createdById: partnerUser.id,
        items: {
          create: {
            serviceCode: "DOCUMENT_PRINT",
            paperCodes: ["STANDARD"],
            colorModes: ["COLOR"],
            maxQuantity: 100,
          },
        },
      },
    });
    await prisma.branchCapacityVersion.create({
      data: {
        branchId: branch.id,
        version: 1,
        maxConcurrentOrders: 10,
        createdById: partnerUser.id,
      },
    });
    await prisma.order.update({
      where: { id: result.order.id },
      data: { status: "PAID" },
    });
    const started = await matching.startOrder(
      result.order.id,
      hash(`stage13-zone:${result.order.id}`),
    );
    expect(started.offerCreated).toBe(false);
    const evaluation =
      await prisma.matchingCandidateEvaluation.findFirstOrThrow({
        where: { matching: { orderId: result.order.id }, branchId: branch.id },
      });
    expect(evaluation.reasonCodes).toContain("OUTSIDE_SERVICE_AREA");
    expect(
      await prisma.partnerOffer.count({ where: { orderId: result.order.id } }),
    ).toBe(0);
  });

  it("activates one committed pickup per production cycle under a concurrent retry", async () => {
    const result = await checkout("PICKUP");
    const owner = await prisma.user.create({
      data: { phone: "+998000000157" },
    });
    const partner = await prisma.partner.create({
      data: {
        ownerId: owner.id,
        displayName: "Synthetic pickup studio",
        status: "ACTIVE",
        approvedAt: new Date(),
        branches: { create: { name: "Pickup branch", city: "Tashkent" } },
      },
      include: { branches: true },
    });
    const branch = partner.branches[0]!;
    const capability = await prisma.branchCapabilityVersion.create({
      data: {
        branchId: branch.id,
        version: 1,
        supportedFileKinds: ["PDF"],
        maxPages: 100,
        maxWidthMm: 500,
        maxHeightMm: 500,
        minDpi: 72,
        priority: 1,
        createdById: owner.id,
      },
    });
    const offer = await prisma.partnerOffer.create({
      data: {
        orderId: result.order.id,
        partnerId: partner.id,
        branchId: branch.id,
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
        customerAmountMinor: 1_500n,
        partnerPayoutMinor: 1_200n,
        agatCommissionMinor: 300n,
        currency: "UZS",
        ruleVersion: "stage13-test",
        calculationInputs: { basisPoints: 8000 },
      },
    });
    const assignment = await prisma.partnerAssignment.create({
      data: {
        orderId: result.order.id,
        offerId: offer.id,
        partnerId: partner.id,
        branchId: branch.id,
        payoutSnapshotId: payout.id,
        status: "READY",
        active: false,
        readyAt: new Date(),
      },
    });
    const cycle = await prisma.productionCycle.create({
      data: {
        orderId: result.order.id,
        sequence: 1,
        kind: "ORIGINAL",
        assignmentId: assignment.id,
        printReadyVersionId: (
          await prisma.order.findUniqueOrThrow({
            where: { id: result.order.id },
          })
        ).printReadyVersionId,
        status: "READY",
      },
    });
    await prisma.order.update({
      where: { id: result.order.id },
      data: { status: "READY" },
    });
    const key = randomUUID();
    const [first, replay] = await Promise.all([
      fulfillment.activateCommittedFulfillment(
        customerId,
        result.order.id,
        key,
      ),
      fulfillment.activateCommittedFulfillment(
        customerId,
        result.order.id,
        key,
      ),
    ]);
    expect(replay).toEqual(JSON.parse(JSON.stringify(first)));
    expect(
      await prisma.orderFulfillment.count({
        where: { productionCycleId: cycle.id },
      }),
    ).toBe(1);
    const row = await prisma.orderFulfillment.findFirstOrThrow({
      where: { productionCycleId: cycle.id },
    });
    expect(row.selectionSnapshotId).toBeTruthy();
    expect(row.mode).toBe("PICKUP");
  });
});
