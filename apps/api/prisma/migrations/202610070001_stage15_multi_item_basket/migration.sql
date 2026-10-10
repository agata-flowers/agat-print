-- CreateEnum
CREATE TYPE "public"."OrderBasketStatus" AS ENUM ('ACTIVE', 'QUOTED', 'CHECKED_OUT', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."BasketQuoteStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'STALE', 'EXPIRED');

-- DropIndex
DROP INDEX "public"."PrintJob_productionCycleId_key";

-- AlterTable
ALTER TABLE "public"."PlatformCatalogItem" ADD COLUMN     "descriptionEn" VARCHAR(500),
ADD COLUMN     "titleEn" VARCHAR(120);

-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "basketId" UUID,
ADD COLUMN     "basketQuoteId" UUID;

-- AlterTable
ALTER TABLE "public"."PrintJob" ADD COLUMN     "productionCycleItemId" UUID;

ALTER TABLE "public"."OfferCapacityReservation" ADD COLUMN "demandUnits" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "public"."OrderBasket" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "public"."OrderBasketStatus" NOT NULL DEFAULT 'ACTIVE',
    "locale" VARCHAR(8) NOT NULL DEFAULT 'ru',
    "version" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "checkedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderBasket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderBasketItem" (
    "id" UUID NOT NULL,
    "basketId" UUID NOT NULL,
    "draftId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "OrderBasketItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderBasketStudioPreference" (
    "id" UUID NOT NULL,
    "basketId" UUID NOT NULL,
    "mode" "public"."StudioPreferenceMode" NOT NULL DEFAULT 'AUTO_ASSIGN',
    "fallbackPolicy" "public"."StudioFallbackPolicy" NOT NULL DEFAULT 'ALLOW_ELIGIBLE_ALTERNATIVE',
    "branchId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderBasketStudioPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderBasketFulfillmentPreference" (
    "id" UUID NOT NULL,
    "basketId" UUID NOT NULL,
    "mode" "public"."FulfillmentMode" NOT NULL,
    "locationCode" VARCHAR(40) NOT NULL,
    "addressCiphertext" TEXT,
    "addressIv" VARCHAR(24),
    "addressAuthTag" VARCHAR(32),
    "addressKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 0,
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderBasketFulfillmentPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BasketQuote" (
    "id" UUID NOT NULL,
    "basketId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "basketVersion" INTEGER NOT NULL,
    "tariffVersionId" UUID NOT NULL,
    "tariffVersion" INTEGER NOT NULL,
    "fulfillmentFeeMinor" BIGINT NOT NULL DEFAULT 0,
    "subtotalMinor" BIGINT NOT NULL,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "membershipHash" CHAR(64) NOT NULL,
    "status" "public"."BasketQuoteStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "fulfillmentRuleId" UUID,
    "studioMode" "public"."StudioPreferenceMode" NOT NULL,
    "studioFallbackPolicy" "public"."StudioFallbackPolicy" NOT NULL,
    "studioBranchId" UUID,
    "studioListingId" UUID,
    "studioCapabilityId" UUID,
    "studioOperationalId" UUID,
    "studioCatalogId" UUID,
    "studioCapacityId" UUID,

    CONSTRAINT "BasketQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BasketQuoteItem" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "basketItemId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "catalogItemId" UUID NOT NULL,
    "draftVersion" INTEGER NOT NULL,
    "layoutVersion" INTEGER NOT NULL,
    "layoutApprovalId" UUID NOT NULL,
    "printReadyVersionId" UUID NOT NULL,
    "configurationHash" CHAR(64) NOT NULL,
    "sourceParameters" JSONB NOT NULL,
    "lineItems" JSONB NOT NULL,
    "quantity" INTEGER NOT NULL,
    "subtotalMinor" BIGINT NOT NULL,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',

    CONSTRAINT "BasketQuoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "sourceDraftId" UUID,
    "catalogItemId" UUID NOT NULL,
    "serviceCode" VARCHAR(40) NOT NULL,
    "configuration" JSONB NOT NULL,
    "configurationHash" CHAR(64) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "layoutId" UUID NOT NULL,
    "layoutApprovalId" UUID NOT NULL,
    "printReadyVersionId" UUID NOT NULL,
    "subtotalMinor" BIGINT NOT NULL,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DisputeOrderItemScope" (
    "disputeId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeOrderItemScope_pkey" PRIMARY KEY ("disputeId","orderItemId")
);

-- CreateTable
CREATE TABLE "public"."ProductionCycleItem" (
    "id" UUID NOT NULL,
    "productionCycleId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "printReadyVersionId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionCycleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderBasket_userId_status_updatedAt_idx" ON "public"."OrderBasket"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "OrderBasket_status_expiresAt_idx" ON "public"."OrderBasket"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "OrderBasketItem_draftId_idx" ON "public"."OrderBasketItem"("draftId");

-- CreateIndex
CREATE INDEX "OrderBasketItem_basketId_createdAt_idx" ON "public"."OrderBasketItem"("basketId", "createdAt");

CREATE INDEX "OrderBasketItem_basketId_removedAt_idx" ON "public"."OrderBasketItem"("basketId", "removedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderBasketItem_active_sequence_key" ON "public"."OrderBasketItem"("basketId", "sequence") WHERE "removedAt" IS NULL;

CREATE INDEX "OrderBasketItem_basketId_sequence_idx" ON "public"."OrderBasketItem"("basketId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "OrderBasketStudioPreference_basketId_key" ON "public"."OrderBasketStudioPreference"("basketId");

-- CreateIndex
CREATE INDEX "OrderBasketStudioPreference_branchId_mode_idx" ON "public"."OrderBasketStudioPreference"("branchId", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "OrderBasketFulfillmentPreference_basketId_key" ON "public"."OrderBasketFulfillmentPreference"("basketId");

-- CreateIndex
CREATE INDEX "OrderBasketFulfillmentPreference_mode_locationCode_idx" ON "public"."OrderBasketFulfillmentPreference"("mode", "locationCode");

-- CreateIndex
CREATE INDEX "BasketQuote_basketId_status_expiresAt_idx" ON "public"."BasketQuote"("basketId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BasketQuote_basketId_sequence_key" ON "public"."BasketQuote"("basketId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "BasketQuoteItem_quoteId_sequence_key" ON "public"."BasketQuoteItem"("quoteId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "BasketQuoteItem_quoteId_basketItemId_key" ON "public"."BasketQuoteItem"("quoteId", "basketItemId");

-- CreateIndex
CREATE INDEX "OrderItem_printReadyVersionId_idx" ON "public"."OrderItem"("printReadyVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_sequence_key" ON "public"."OrderItem"("orderId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_sourceDraftId_key" ON "public"."OrderItem"("orderId", "sourceDraftId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionCycleItem_productionCycleId_sequence_key" ON "public"."ProductionCycleItem"("productionCycleId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionCycleItem_productionCycleId_orderItemId_key" ON "public"."ProductionCycleItem"("productionCycleId", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_basketId_key" ON "public"."Order"("basketId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_basketQuoteId_key" ON "public"."Order"("basketQuoteId");

-- CreateIndex
CREATE UNIQUE INDEX "PrintJob_productionCycleItemId_key" ON "public"."PrintJob"("productionCycleItemId");

-- CreateIndex
CREATE INDEX "PrintJob_productionCycleId_status_idx" ON "public"."PrintJob"("productionCycleId", "status");

-- AddForeignKey
ALTER TABLE "public"."OrderBasket" ADD CONSTRAINT "OrderBasket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderBasketItem" ADD CONSTRAINT "OrderBasketItem_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "public"."OrderBasket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderBasketItem" ADD CONSTRAINT "OrderBasketItem_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "public"."OrderDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderBasketStudioPreference" ADD CONSTRAINT "OrderBasketStudioPreference_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "public"."OrderBasket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderBasketStudioPreference" ADD CONSTRAINT "OrderBasketStudioPreference_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "public"."Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderBasketFulfillmentPreference" ADD CONSTRAINT "OrderBasketFulfillmentPreference_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "public"."OrderBasket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BasketQuote" ADD CONSTRAINT "BasketQuote_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "public"."OrderBasket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BasketQuote" ADD CONSTRAINT "BasketQuote_tariffVersionId_fkey" FOREIGN KEY ("tariffVersionId") REFERENCES "public"."TariffVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BasketQuote" ADD CONSTRAINT "BasketQuote_fulfillmentRuleId_fkey" FOREIGN KEY ("fulfillmentRuleId") REFERENCES "public"."FulfillmentTariffRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BasketQuoteItem" ADD CONSTRAINT "BasketQuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "public"."BasketQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BasketQuoteItem" ADD CONSTRAINT "BasketQuoteItem_basketItemId_fkey" FOREIGN KEY ("basketItemId") REFERENCES "public"."OrderBasketItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BasketQuoteItem" ADD CONSTRAINT "BasketQuoteItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "public"."PlatformCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BasketQuoteItem" ADD CONSTRAINT "BasketQuoteItem_layoutApprovalId_fkey" FOREIGN KEY ("layoutApprovalId") REFERENCES "public"."LayoutApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BasketQuoteItem" ADD CONSTRAINT "BasketQuoteItem_printReadyVersionId_fkey" FOREIGN KEY ("printReadyVersionId") REFERENCES "public"."PrintReadyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "public"."OrderBasket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_basketQuoteId_fkey" FOREIGN KEY ("basketQuoteId") REFERENCES "public"."BasketQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_sourceDraftId_fkey" FOREIGN KEY ("sourceDraftId") REFERENCES "public"."OrderDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "public"."PlatformCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "public"."LayoutRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_layoutApprovalId_fkey" FOREIGN KEY ("layoutApprovalId") REFERENCES "public"."LayoutApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_printReadyVersionId_fkey" FOREIGN KEY ("printReadyVersionId") REFERENCES "public"."PrintReadyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PrintJob" ADD CONSTRAINT "PrintJob_productionCycleItemId_fkey" FOREIGN KEY ("productionCycleItemId") REFERENCES "public"."ProductionCycleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DisputeOrderItemScope" ADD CONSTRAINT "DisputeOrderItemScope_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "public"."DisputeCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DisputeOrderItemScope" ADD CONSTRAINT "DisputeOrderItemScope_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "public"."OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductionCycleItem" ADD CONSTRAINT "ProductionCycleItem_productionCycleId_fkey" FOREIGN KEY ("productionCycleId") REFERENCES "public"."ProductionCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductionCycleItem" ADD CONSTRAINT "ProductionCycleItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "public"."OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductionCycleItem" ADD CONSTRAINT "ProductionCycleItem_printReadyVersionId_fkey" FOREIGN KEY ("printReadyVersionId") REFERENCES "public"."PrintReadyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Stage 15 bounded invariants and presentation locales.
ALTER TABLE "OrderDraft" DROP CONSTRAINT "OrderDraft_locale_check";
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_locale_check" CHECK ("locale" IN ('uz','ru','en'));
ALTER TABLE "OrderBasket" ADD CONSTRAINT "OrderBasket_locale_check" CHECK ("locale" IN ('uz','ru','en'));
ALTER TABLE "BasketQuote" ADD CONSTRAINT "BasketQuote_money_check" CHECK ("currency" = 'UZS' AND "subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "totalMinor" >= 0 AND "totalMinor" = "subtotalMinor" - "discountMinor");
ALTER TABLE "BasketQuoteItem" ADD CONSTRAINT "BasketQuoteItem_values_check" CHECK ("sequence" BETWEEN 1 AND 10 AND "quantity" > 0 AND "currency" = 'UZS' AND "subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "totalMinor" = "subtotalMinor" - "discountMinor");
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_values_check" CHECK ("sequence" BETWEEN 1 AND 10 AND "quantity" > 0 AND "currency" = 'UZS' AND "subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "totalMinor" = "subtotalMinor" - "discountMinor");

-- Deterministic compatibility projection for every accepted legacy order.
INSERT INTO "OrderItem" (
  "id", "orderId", "sequence", "sourceDraftId", "catalogItemId", "serviceCode",
  "configuration", "configurationHash", "quantity", "layoutId", "layoutApprovalId",
  "printReadyVersionId", "subtotalMinor", "discountMinor", "totalMinor", "currency", "createdAt"
)
SELECT gen_random_uuid(), o."id", 1, d."id", d."catalogItemId", d."serviceCode",
  d."configuration", encode(digest(d."configuration"::text, 'sha256'), 'hex'),
  ps."quantity", o."layoutId", o."layoutApprovalId", o."printReadyVersionId",
  ps."subtotalMinor", ps."discountMinor", ps."totalMinor", ps."currency", o."createdAt"
FROM "Order" o
JOIN "PriceSnapshot" ps ON ps."orderId" = o."id"
JOIN "OrderDraft" d ON d."id" = o."orderDraftId"
ON CONFLICT ("orderId", "sequence") DO NOTHING;

INSERT INTO "ProductionCycleItem" (
  "id", "productionCycleId", "orderItemId", "sequence", "printReadyVersionId", "createdAt"
)
SELECT gen_random_uuid(), pc."id", oi."id", 1, pc."printReadyVersionId", pc."createdAt"
FROM "ProductionCycle" pc
JOIN "OrderItem" oi ON oi."orderId" = pc."orderId" AND oi."sequence" = 1
ON CONFLICT ("productionCycleId", "sequence") DO NOTHING;

UPDATE "PrintJob" pj SET "productionCycleItemId" = pci."id"
FROM "ProductionCycleItem" pci
WHERE pci."productionCycleId" = pj."productionCycleId" AND pci."sequence" = 1
  AND pj."productionCycleItemId" IS NULL;

-- Immutable commercial and production lineage.
CREATE FUNCTION reject_stage15_immutable_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'immutable stage15 record';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BasketQuoteItem_immutable" BEFORE UPDATE OR DELETE ON "BasketQuoteItem"
FOR EACH ROW EXECUTE FUNCTION reject_stage15_immutable_change();
CREATE TRIGGER "OrderItem_immutable" BEFORE UPDATE OR DELETE ON "OrderItem"
FOR EACH ROW EXECUTE FUNCTION reject_stage15_immutable_change();
CREATE TRIGGER "ProductionCycleItem_source_immutable" BEFORE UPDATE OR DELETE ON "ProductionCycleItem"
FOR EACH ROW EXECUTE FUNCTION reject_stage15_immutable_change();
CREATE TRIGGER "DisputeOrderItemScope_immutable" BEFORE UPDATE OR DELETE ON "DisputeOrderItemScope"
FOR EACH ROW EXECUTE FUNCTION reject_stage15_immutable_change();

CREATE FUNCTION protect_stage15_quote_lineage() RETURNS trigger AS $$
BEGIN
  IF NEW."basketId" <> OLD."basketId"
    OR NEW."sequence" <> OLD."sequence"
    OR NEW."basketVersion" <> OLD."basketVersion"
    OR NEW."tariffVersionId" <> OLD."tariffVersionId"
    OR NEW."tariffVersion" <> OLD."tariffVersion"
    OR NEW."fulfillmentFeeMinor" <> OLD."fulfillmentFeeMinor"
    OR NEW."subtotalMinor" <> OLD."subtotalMinor"
    OR NEW."discountMinor" <> OLD."discountMinor"
    OR NEW."totalMinor" <> OLD."totalMinor"
    OR NEW."currency" <> OLD."currency"
    OR NEW."membershipHash" <> OLD."membershipHash"
    OR NEW."expiresAt" <> OLD."expiresAt"
    OR NEW."fulfillmentRuleId" IS DISTINCT FROM OLD."fulfillmentRuleId"
    OR NEW."studioMode" <> OLD."studioMode"
    OR NEW."studioFallbackPolicy" <> OLD."studioFallbackPolicy"
    OR NEW."studioBranchId" IS DISTINCT FROM OLD."studioBranchId"
    OR NEW."studioListingId" IS DISTINCT FROM OLD."studioListingId"
    OR NEW."studioCapabilityId" IS DISTINCT FROM OLD."studioCapabilityId"
    OR NEW."studioOperationalId" IS DISTINCT FROM OLD."studioOperationalId"
    OR NEW."studioCatalogId" IS DISTINCT FROM OLD."studioCatalogId"
    OR NEW."studioCapacityId" IS DISTINCT FROM OLD."studioCapacityId"
    OR NEW."createdAt" <> OLD."createdAt"
  THEN
    RAISE EXCEPTION 'immutable stage15 quote lineage';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BasketQuote_lineage_immutable" BEFORE UPDATE ON "BasketQuote"
FOR EACH ROW EXECUTE FUNCTION protect_stage15_quote_lineage();
CREATE TRIGGER "BasketQuote_no_delete" BEFORE DELETE ON "BasketQuote"
FOR EACH ROW EXECUTE FUNCTION reject_stage15_immutable_change();
