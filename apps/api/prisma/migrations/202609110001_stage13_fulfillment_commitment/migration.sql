ALTER TABLE "OrderDraft" ADD COLUMN "fulfillmentRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PriceQuote" ADD COLUMN "fulfillmentPreferenceVersion" INTEGER;
ALTER TABLE "PriceQuote" ADD COLUMN "fulfillmentTariffRuleId" UUID;
ALTER TABLE "OrderFulfillment" ADD COLUMN "selectionSnapshotId" UUID;

CREATE TABLE "FulfillmentTariffRule" (
  "id" UUID NOT NULL,
  "tariffVersionId" UUID NOT NULL,
  "mode" "FulfillmentMode" NOT NULL,
  "locationCode" VARCHAR(40) NOT NULL,
  "feeMinor" BIGINT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FulfillmentTariffRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FulfillmentTariffRule_fee_check" CHECK ("feeMinor" >= 0),
  CONSTRAINT "FulfillmentTariffRule_location_check" CHECK (
    "locationCode" ~ '^[A-Z0-9_]{2,40}$'
  )
);

CREATE TABLE "OrderDraftFulfillmentPreference" (
  "id" UUID NOT NULL,
  "draftId" UUID NOT NULL,
  "mode" "FulfillmentMode" NOT NULL,
  "locationCode" VARCHAR(40) NOT NULL,
  "addressCiphertext" TEXT,
  "addressIv" VARCHAR(24),
  "addressAuthTag" VARCHAR(32),
  "addressKeyVersion" INTEGER NOT NULL DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 0,
  "invalidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderDraftFulfillmentPreference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderDraftFulfillmentPreference_fields_check" CHECK (
    ("mode" = 'PICKUP' AND "locationCode" = 'PICKUP' AND "addressCiphertext" IS NULL AND "addressIv" IS NULL AND "addressAuthTag" IS NULL) OR
    ("mode" = 'DELIVERY' AND "locationCode" ~ '^[A-Z0-9_]{2,40}$' AND "locationCode" <> 'PICKUP' AND "addressCiphertext" IS NOT NULL AND "addressIv" IS NOT NULL AND "addressAuthTag" IS NOT NULL)
  )
);

CREATE TABLE "OrderFulfillmentSelectionSnapshot" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "mode" "FulfillmentMode" NOT NULL,
  "locationCode" VARCHAR(40) NOT NULL,
  "addressCiphertext" TEXT,
  "addressIv" VARCHAR(24),
  "addressAuthTag" VARCHAR(32),
  "addressKeyVersion" INTEGER NOT NULL DEFAULT 1,
  "sourcePreferenceVersion" INTEGER NOT NULL,
  "fulfillmentTariffRuleId" UUID NOT NULL,
  "feeMinor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderFulfillmentSelectionSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderFulfillmentSelectionSnapshot_fee_check" CHECK ("feeMinor" >= 0),
  CONSTRAINT "OrderFulfillmentSelectionSnapshot_fields_check" CHECK (
    ("mode" = 'PICKUP' AND "locationCode" = 'PICKUP' AND "addressCiphertext" IS NULL AND "addressIv" IS NULL AND "addressAuthTag" IS NULL) OR
    ("mode" = 'DELIVERY' AND "locationCode" ~ '^[A-Z0-9_]{2,40}$' AND "locationCode" <> 'PICKUP' AND "addressCiphertext" IS NOT NULL AND "addressIv" IS NOT NULL AND "addressAuthTag" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "FulfillmentTariffRule_tariffVersionId_mode_locationCode_key" ON "FulfillmentTariffRule"("tariffVersionId", "mode", "locationCode");
CREATE INDEX "FulfillmentTariffRule_tariffVersionId_enabled_idx" ON "FulfillmentTariffRule"("tariffVersionId", "enabled");
CREATE UNIQUE INDEX "OrderDraftFulfillmentPreference_draftId_key" ON "OrderDraftFulfillmentPreference"("draftId");
CREATE INDEX "OrderDraftFulfillmentPreference_mode_locationCode_idx" ON "OrderDraftFulfillmentPreference"("mode", "locationCode");
CREATE UNIQUE INDEX "OrderFulfillmentSelectionSnapshot_orderId_key" ON "OrderFulfillmentSelectionSnapshot"("orderId");
CREATE INDEX "OrderFulfillmentSelectionSnapshot_mode_locationCode_idx" ON "OrderFulfillmentSelectionSnapshot"("mode", "locationCode");
CREATE INDEX "OrderFulfillment_selectionSnapshotId_idx" ON "OrderFulfillment"("selectionSnapshotId");

ALTER TABLE "FulfillmentTariffRule" ADD CONSTRAINT "FulfillmentTariffRule_tariffVersionId_fkey" FOREIGN KEY ("tariffVersionId") REFERENCES "TariffVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderDraftFulfillmentPreference" ADD CONSTRAINT "OrderDraftFulfillmentPreference_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "OrderDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderFulfillmentSelectionSnapshot" ADD CONSTRAINT "OrderFulfillmentSelectionSnapshot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderFulfillmentSelectionSnapshot" ADD CONSTRAINT "OrderFulfillmentSelectionSnapshot_fulfillmentTariffRuleId_fkey" FOREIGN KEY ("fulfillmentTariffRuleId") REFERENCES "FulfillmentTariffRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_fulfillmentTariffRuleId_fkey" FOREIGN KEY ("fulfillmentTariffRuleId") REFERENCES "FulfillmentTariffRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderFulfillment" ADD CONSTRAINT "OrderFulfillment_selectionSnapshotId_fkey" FOREIGN KEY ("selectionSnapshotId") REFERENCES "OrderFulfillmentSelectionSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "FulfillmentTariffRule_immutable" BEFORE UPDATE OR DELETE ON "FulfillmentTariffRule" FOR EACH ROW EXECUTE FUNCTION agat_reject_immutable_update();
CREATE TRIGGER "OrderFulfillmentSelectionSnapshot_immutable" BEFORE UPDATE OR DELETE ON "OrderFulfillmentSelectionSnapshot" FOR EACH ROW EXECUTE FUNCTION agat_reject_immutable_update();

-- Existing and directly seeded rows retain the Stage 7 late-choice path. The
-- Stage 13 application marks newly created pilot drafts as required.
