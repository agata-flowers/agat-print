ALTER TYPE "MatchingReasonCode" ADD VALUE 'CUSTOMER_PREFERRED';

CREATE TYPE "StudioListingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PUBLISHED', 'REJECTED', 'RETIRED');
CREATE TYPE "StudioPreferenceMode" AS ENUM ('AUTO_ASSIGN', 'PREFERRED_STUDIO');
CREATE TYPE "StudioFallbackPolicy" AS ENUM ('ALLOW_ELIGIBLE_ALTERNATIVE', 'STRICT_PREFERENCE');

CREATE TABLE "StudioListingVersion" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "publicSlug" VARCHAR(80) NOT NULL,
  "status" "StudioListingStatus" NOT NULL DEFAULT 'DRAFT',
  "titleRu" VARCHAR(120) NOT NULL,
  "titleUz" VARCHAR(120) NOT NULL,
  "descriptionRu" VARCHAR(500) NOT NULL,
  "descriptionUz" VARCHAR(500) NOT NULL,
  "createdById" UUID NOT NULL,
  "moderatedById" UUID,
  "moderationCode" VARCHAR(40),
  "submittedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudioListingVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderDraftStudioPreference" (
  "id" UUID NOT NULL,
  "draftId" UUID NOT NULL,
  "mode" "StudioPreferenceMode" NOT NULL DEFAULT 'AUTO_ASSIGN',
  "fallbackPolicy" "StudioFallbackPolicy" NOT NULL DEFAULT 'ALLOW_ELIGIBLE_ALTERNATIVE',
  "listingId" UUID,
  "branchId" UUID,
  "capabilityVersionId" UUID,
  "operationalVersionId" UUID,
  "catalogVersionId" UUID,
  "capacityVersionId" UUID,
  "version" INTEGER NOT NULL DEFAULT 0,
  "invalidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderDraftStudioPreference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderDraftStudioPreference_mode_check" CHECK (
    ("mode" = 'AUTO_ASSIGN' AND "listingId" IS NULL AND "branchId" IS NULL AND
      "capabilityVersionId" IS NULL AND "operationalVersionId" IS NULL AND
      "catalogVersionId" IS NULL AND "capacityVersionId" IS NULL) OR
    ("mode" = 'PREFERRED_STUDIO' AND "listingId" IS NOT NULL AND "branchId" IS NOT NULL AND
      "capabilityVersionId" IS NOT NULL AND "operationalVersionId" IS NOT NULL AND
      "catalogVersionId" IS NOT NULL AND "capacityVersionId" IS NOT NULL)
  )
);

CREATE TABLE "OrderStudioSelectionSnapshot" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "mode" "StudioPreferenceMode" NOT NULL,
  "fallbackPolicy" "StudioFallbackPolicy" NOT NULL,
  "listingId" UUID,
  "branchId" UUID,
  "listingSequence" INTEGER,
  "capabilityVersionId" UUID,
  "operationalVersionId" UUID,
  "catalogVersionId" UUID,
  "capacityVersionId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderStudioSelectionSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderStudioSelectionSnapshot_mode_check" CHECK (
    ("mode" = 'AUTO_ASSIGN' AND "listingId" IS NULL AND "branchId" IS NULL) OR
    ("mode" = 'PREFERRED_STUDIO' AND "listingId" IS NOT NULL AND "branchId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "StudioListingVersion_branchId_sequence_key" ON "StudioListingVersion"("branchId", "sequence");
CREATE INDEX "StudioListingVersion_status_publicSlug_idx" ON "StudioListingVersion"("status", "publicSlug");
CREATE INDEX "StudioListingVersion_branchId_status_sequence_idx" ON "StudioListingVersion"("branchId", "status", "sequence");
CREATE UNIQUE INDEX "StudioListingVersion_one_published_branch" ON "StudioListingVersion"("branchId") WHERE "status" = 'PUBLISHED';
CREATE UNIQUE INDEX "StudioListingVersion_one_published_slug" ON "StudioListingVersion"("publicSlug") WHERE "status" = 'PUBLISHED';
CREATE UNIQUE INDEX "OrderDraftStudioPreference_draftId_key" ON "OrderDraftStudioPreference"("draftId");
CREATE INDEX "OrderDraftStudioPreference_branchId_mode_idx" ON "OrderDraftStudioPreference"("branchId", "mode");
CREATE UNIQUE INDEX "OrderStudioSelectionSnapshot_orderId_key" ON "OrderStudioSelectionSnapshot"("orderId");
CREATE INDEX "OrderStudioSelectionSnapshot_branchId_mode_idx" ON "OrderStudioSelectionSnapshot"("branchId", "mode");

ALTER TABLE "StudioListingVersion" ADD CONSTRAINT "StudioListingVersion_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioListingVersion" ADD CONSTRAINT "StudioListingVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioListingVersion" ADD CONSTRAINT "StudioListingVersion_moderatedById_fkey" FOREIGN KEY ("moderatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderDraftStudioPreference" ADD CONSTRAINT "OrderDraftStudioPreference_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "OrderDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderDraftStudioPreference" ADD CONSTRAINT "OrderDraftStudioPreference_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "StudioListingVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderDraftStudioPreference" ADD CONSTRAINT "OrderDraftStudioPreference_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderDraftStudioPreference" ADD CONSTRAINT "OrderDraftStudioPreference_capabilityVersionId_fkey" FOREIGN KEY ("capabilityVersionId") REFERENCES "BranchCapabilityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderDraftStudioPreference" ADD CONSTRAINT "OrderDraftStudioPreference_operationalVersionId_fkey" FOREIGN KEY ("operationalVersionId") REFERENCES "BranchOperationalVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderDraftStudioPreference" ADD CONSTRAINT "OrderDraftStudioPreference_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "BranchCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderDraftStudioPreference" ADD CONSTRAINT "OrderDraftStudioPreference_capacityVersionId_fkey" FOREIGN KEY ("capacityVersionId") REFERENCES "BranchCapacityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderStudioSelectionSnapshot" ADD CONSTRAINT "OrderStudioSelectionSnapshot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderStudioSelectionSnapshot" ADD CONSTRAINT "OrderStudioSelectionSnapshot_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "StudioListingVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderStudioSelectionSnapshot" ADD CONSTRAINT "OrderStudioSelectionSnapshot_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderStudioSelectionSnapshot" ADD CONSTRAINT "OrderStudioSelectionSnapshot_capabilityVersionId_fkey" FOREIGN KEY ("capabilityVersionId") REFERENCES "BranchCapabilityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderStudioSelectionSnapshot" ADD CONSTRAINT "OrderStudioSelectionSnapshot_operationalVersionId_fkey" FOREIGN KEY ("operationalVersionId") REFERENCES "BranchOperationalVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderStudioSelectionSnapshot" ADD CONSTRAINT "OrderStudioSelectionSnapshot_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "BranchCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderStudioSelectionSnapshot" ADD CONSTRAINT "OrderStudioSelectionSnapshot_capacityVersionId_fkey" FOREIGN KEY ("capacityVersionId") REFERENCES "BranchCapacityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION stage12_listing_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'PUBLISHED' AND (
    NEW."branchId" IS DISTINCT FROM OLD."branchId" OR NEW."sequence" IS DISTINCT FROM OLD."sequence" OR
    NEW."publicSlug" IS DISTINCT FROM OLD."publicSlug" OR NEW."titleRu" IS DISTINCT FROM OLD."titleRu" OR
    NEW."titleUz" IS DISTINCT FROM OLD."titleUz" OR NEW."descriptionRu" IS DISTINCT FROM OLD."descriptionRu" OR
    NEW."descriptionUz" IS DISTINCT FROM OLD."descriptionUz" OR NEW."createdById" IS DISTINCT FROM OLD."createdById" OR
    NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
  ) THEN RAISE EXCEPTION 'published studio listing content is immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "StudioListingVersion_immutable_published" BEFORE UPDATE ON "StudioListingVersion" FOR EACH ROW EXECUTE FUNCTION stage12_listing_immutable();

CREATE FUNCTION stage12_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'order studio selection snapshot is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "OrderStudioSelectionSnapshot_no_update" BEFORE UPDATE OR DELETE ON "OrderStudioSelectionSnapshot" FOR EACH ROW EXECUTE FUNCTION stage12_snapshot_immutable();
