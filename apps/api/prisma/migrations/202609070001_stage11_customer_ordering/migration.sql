CREATE TYPE "PlatformCatalogStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "OrderDraftStatus" AS ENUM ('CONFIGURING', 'FILE_UPLOADED', 'PROCESSING', 'AWAITING_APPROVAL', 'READY_FOR_QUOTE', 'QUOTED', 'CHECKED_OUT', 'CANCELLED', 'EXPIRED');
CREATE TYPE "PriceQuoteStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'STALE', 'EXPIRED');
CREATE TYPE "NotificationStatus" AS ENUM ('UNREAD', 'READ');
CREATE TYPE "NotificationJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'DEAD_LETTER');

CREATE TABLE "PlatformCatalogVersion" (
  "id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "PlatformCatalogStatus" NOT NULL DEFAULT 'DRAFT',
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  CONSTRAINT "PlatformCatalogVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformCatalogItem" (
  "id" UUID NOT NULL,
  "catalogVersionId" UUID NOT NULL,
  "serviceCode" VARCHAR(40) NOT NULL,
  "slug" VARCHAR(80) NOT NULL,
  "titleRu" VARCHAR(120) NOT NULL,
  "titleUz" VARCHAR(120) NOT NULL,
  "descriptionRu" VARCHAR(500) NOT NULL,
  "descriptionUz" VARCHAR(500) NOT NULL,
  "acceptedFileKinds" "UploadFileKind"[] NOT NULL,
  "optionSchema" JSONB NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "PlatformCatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TariffRule" (
  "id" UUID NOT NULL,
  "tariffVersionId" UUID NOT NULL,
  "serviceCode" VARCHAR(40) NOT NULL,
  "basePriceMinor" BIGINT NOT NULL,
  "perPagePriceMinor" BIGINT NOT NULL,
  "optionPrices" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TariffRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderDraft" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "catalogVersionId" UUID NOT NULL,
  "catalogItemId" UUID NOT NULL,
  "serviceCode" VARCHAR(40) NOT NULL,
  "locale" VARCHAR(8) NOT NULL DEFAULT 'ru',
  "configuration" JSONB NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "status" "OrderDraftStatus" NOT NULL DEFAULT 'CONFIGURING',
  "version" INTEGER NOT NULL DEFAULT 0,
  "uploadId" UUID,
  "layoutId" UUID,
  "layoutApprovalId" UUID,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "checkedOutAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceQuote" (
  "id" UUID NOT NULL,
  "draftId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "draftVersion" INTEGER NOT NULL,
  "catalogVersionId" UUID NOT NULL,
  "catalogItemId" UUID NOT NULL,
  "tariffVersionId" UUID NOT NULL,
  "tariffVersion" INTEGER NOT NULL,
  "layoutVersion" INTEGER NOT NULL,
  "layoutApprovalId" UUID NOT NULL,
  "sourceParameters" JSONB NOT NULL,
  "lineItems" JSONB NOT NULL,
  "quantity" INTEGER NOT NULL,
  "subtotalMinor" BIGINT NOT NULL,
  "discountMinor" BIGINT NOT NULL DEFAULT 0,
  "totalMinor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
  "status" "PriceQuoteStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumedAt" TIMESTAMP(3),
  CONSTRAINT "PriceQuote_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Order" ADD COLUMN "orderDraftId" UUID;
ALTER TABLE "Order" ADD COLUMN "priceQuoteId" UUID;

CREATE TABLE "CustomerOrderEvent" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "outboxEventId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "eventCode" VARCHAR(80) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerOrderEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserNotification" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "outboxEventId" UUID NOT NULL,
  "eventCode" VARCHAR(80) NOT NULL,
  "titleKey" VARCHAR(80) NOT NULL,
  "bodyKey" VARCHAR(80) NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'UNREAD',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3),
  CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationJob" (
  "id" UUID NOT NULL,
  "outboxEventId" UUID NOT NULL,
  "dedupKey" CHAR(64) NOT NULL,
  "status" "NotificationJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseOwner" VARCHAR(100),
  "leaseUntil" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformCatalogVersion_version_key" ON "PlatformCatalogVersion"("version");
CREATE INDEX "PlatformCatalogVersion_status_version_idx" ON "PlatformCatalogVersion"("status", "version");
CREATE UNIQUE INDEX "PlatformCatalogItem_catalogVersionId_serviceCode_key" ON "PlatformCatalogItem"("catalogVersionId", "serviceCode");
CREATE UNIQUE INDEX "PlatformCatalogItem_catalogVersionId_slug_key" ON "PlatformCatalogItem"("catalogVersionId", "slug");
CREATE INDEX "PlatformCatalogItem_catalogVersionId_enabled_sortOrder_idx" ON "PlatformCatalogItem"("catalogVersionId", "enabled", "sortOrder");
CREATE UNIQUE INDEX "TariffRule_tariffVersionId_serviceCode_key" ON "TariffRule"("tariffVersionId", "serviceCode");
CREATE UNIQUE INDEX "OrderDraft_uploadId_key" ON "OrderDraft"("uploadId");
CREATE UNIQUE INDEX "OrderDraft_layoutId_key" ON "OrderDraft"("layoutId");
CREATE UNIQUE INDEX "OrderDraft_layoutApprovalId_key" ON "OrderDraft"("layoutApprovalId");
CREATE INDEX "OrderDraft_userId_status_updatedAt_idx" ON "OrderDraft"("userId", "status", "updatedAt");
CREATE INDEX "OrderDraft_status_expiresAt_idx" ON "OrderDraft"("status", "expiresAt");
CREATE UNIQUE INDEX "PriceQuote_draftId_sequence_key" ON "PriceQuote"("draftId", "sequence");
CREATE INDEX "PriceQuote_draftId_status_expiresAt_idx" ON "PriceQuote"("draftId", "status", "expiresAt");
CREATE UNIQUE INDEX "Order_orderDraftId_key" ON "Order"("orderDraftId");
CREATE UNIQUE INDEX "Order_priceQuoteId_key" ON "Order"("priceQuoteId");
CREATE UNIQUE INDEX "CustomerOrderEvent_orderId_sequence_key" ON "CustomerOrderEvent"("orderId", "sequence");
CREATE UNIQUE INDEX "CustomerOrderEvent_outboxEventId_key" ON "CustomerOrderEvent"("outboxEventId");
CREATE INDEX "CustomerOrderEvent_orderId_createdAt_idx" ON "CustomerOrderEvent"("orderId", "createdAt");
CREATE UNIQUE INDEX "UserNotification_userId_outboxEventId_key" ON "UserNotification"("userId", "outboxEventId");
CREATE INDEX "UserNotification_userId_status_createdAt_idx" ON "UserNotification"("userId", "status", "createdAt");
CREATE UNIQUE INDEX "NotificationJob_outboxEventId_key" ON "NotificationJob"("outboxEventId");
CREATE UNIQUE INDEX "NotificationJob_dedupKey_key" ON "NotificationJob"("dedupKey");
CREATE INDEX "NotificationJob_status_leaseUntil_idx" ON "NotificationJob"("status", "leaseUntil");

ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_quantity_check" CHECK ("quantity" BETWEEN 1 AND 10000);
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_locale_check" CHECK ("locale" IN ('ru', 'uz'));
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_amount_check" CHECK ("subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "totalMinor" >= 0 AND "totalMinor" = "subtotalMinor" - "discountMinor");
ALTER TABLE "TariffRule" ADD CONSTRAINT "TariffRule_amount_check" CHECK ("basePriceMinor" >= 0 AND "perPagePriceMinor" >= 0);

ALTER TABLE "PlatformCatalogVersion" ADD CONSTRAINT "PlatformCatalogVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformCatalogItem" ADD CONSTRAINT "PlatformCatalogItem_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "PlatformCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TariffRule" ADD CONSTRAINT "TariffRule_tariffVersionId_fkey" FOREIGN KEY ("tariffVersionId") REFERENCES "TariffVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "PlatformCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PlatformCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "UploadSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "LayoutRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_layoutApprovalId_fkey" FOREIGN KEY ("layoutApprovalId") REFERENCES "LayoutApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "OrderDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "PlatformCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "PlatformCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_tariffVersionId_fkey" FOREIGN KEY ("tariffVersionId") REFERENCES "TariffVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_orderDraftId_fkey" FOREIGN KEY ("orderDraftId") REFERENCES "OrderDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_priceQuoteId_fkey" FOREIGN KEY ("priceQuoteId") REFERENCES "PriceQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerOrderEvent" ADD CONSTRAINT "CustomerOrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerOrderEvent" ADD CONSTRAINT "CustomerOrderEvent_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "OutboxEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "OutboxEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationJob" ADD CONSTRAINT "NotificationJob_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "OutboxEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION agat_reject_catalog_version_content_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'immutable catalog version'; END IF;
  IF to_jsonb(NEW) - 'status' - 'publishedAt' - 'retiredAt' IS DISTINCT FROM to_jsonb(OLD) - 'status' - 'publishedAt' - 'retiredAt' THEN
    RAISE EXCEPTION 'immutable catalog version content';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION agat_reject_quote_content_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'immutable price quote'; END IF;
  IF to_jsonb(NEW) - 'status' - 'consumedAt' IS DISTINCT FROM to_jsonb(OLD) - 'status' - 'consumedAt' THEN
    RAISE EXCEPTION 'immutable price quote content';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PlatformCatalogVersion_immutable" BEFORE UPDATE OR DELETE ON "PlatformCatalogVersion" FOR EACH ROW EXECUTE FUNCTION agat_reject_catalog_version_content_change();
CREATE TRIGGER "PlatformCatalogItem_immutable" BEFORE UPDATE OR DELETE ON "PlatformCatalogItem" FOR EACH ROW EXECUTE FUNCTION agat_reject_immutable_update();
CREATE TRIGGER "TariffRule_immutable" BEFORE UPDATE OR DELETE ON "TariffRule" FOR EACH ROW EXECUTE FUNCTION agat_reject_immutable_update();
CREATE TRIGGER "PriceQuote_immutable" BEFORE UPDATE OR DELETE ON "PriceQuote" FOR EACH ROW EXECUTE FUNCTION agat_reject_quote_content_change();
CREATE TRIGGER "CustomerOrderEvent_immutable" BEFORE UPDATE OR DELETE ON "CustomerOrderEvent" FOR EACH ROW EXECUTE FUNCTION agat_reject_immutable_update();
