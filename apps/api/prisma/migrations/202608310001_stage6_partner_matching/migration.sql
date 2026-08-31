ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'MATCHING';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PARTNER_OFFERED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PARTNER_ACCEPTED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'IN_PRODUCTION';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'READY';

CREATE TYPE "CapabilityStatus" AS ENUM ('ACTIVE', 'RETIRED');
CREATE TYPE "MatchingStatus" AS ENUM ('ACTIVE', 'ASSIGNED', 'EXHAUSTED');
CREATE TYPE "PartnerOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'READY');

ALTER TABLE "Branch" ADD COLUMN "locationCode" VARCHAR(40) NOT NULL DEFAULT 'TASHKENT';

CREATE TABLE "BranchCapabilityVersion" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "CapabilityStatus" NOT NULL DEFAULT 'ACTIVE',
  "supportedFileKinds" "UploadFileKind"[],
  "maxPages" INTEGER NOT NULL,
  "maxWidthMm" INTEGER NOT NULL,
  "maxHeightMm" INTEGER NOT NULL,
  "minDpi" INTEGER NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt" TIMESTAMP(3),
  CONSTRAINT "BranchCapabilityVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderMatching" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "status" "MatchingStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exhaustedAt" TIMESTAMP(3),
  "assignedAt" TIMESTAMP(3),
  CONSTRAINT "OrderMatching_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerOffer" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "partnerId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "capabilityVersionId" UUID NOT NULL,
  "candidateRank" INTEGER NOT NULL,
  "status" "PartnerOfferStatus" NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerOffer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerPayoutSnapshot" (
  "id" UUID NOT NULL,
  "offerId" UUID NOT NULL,
  "customerAmountMinor" BIGINT NOT NULL,
  "partnerPayoutMinor" BIGINT NOT NULL,
  "agatCommissionMinor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
  "ruleVersion" VARCHAR(40) NOT NULL,
  "calculationInputs" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerPayoutSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerAssignment" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "offerId" UUID NOT NULL,
  "partnerId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "payoutSnapshotId" UUID NOT NULL,
  "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 0,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readyAt" TIMESTAMP(3),
  CONSTRAINT "PartnerAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BranchCapabilityVersion_branchId_version_key" ON "BranchCapabilityVersion"("branchId", "version");
CREATE INDEX "BranchCapabilityVersion_branchId_status_idx" ON "BranchCapabilityVersion"("branchId", "status");
CREATE UNIQUE INDEX "OrderMatching_orderId_key" ON "OrderMatching"("orderId");
CREATE UNIQUE INDEX "PartnerOffer_orderId_branchId_key" ON "PartnerOffer"("orderId", "branchId");
CREATE INDEX "PartnerOffer_partnerId_status_expiresAt_idx" ON "PartnerOffer"("partnerId", "status", "expiresAt");
CREATE INDEX "PartnerOffer_status_expiresAt_idx" ON "PartnerOffer"("status", "expiresAt");
CREATE UNIQUE INDEX "PartnerPayoutSnapshot_offerId_key" ON "PartnerPayoutSnapshot"("offerId");
CREATE UNIQUE INDEX "PartnerAssignment_offerId_key" ON "PartnerAssignment"("offerId");
CREATE UNIQUE INDEX "PartnerAssignment_payoutSnapshotId_key" ON "PartnerAssignment"("payoutSnapshotId");
CREATE INDEX "PartnerAssignment_orderId_active_idx" ON "PartnerAssignment"("orderId", "active");
CREATE INDEX "PartnerAssignment_partnerId_active_idx" ON "PartnerAssignment"("partnerId", "active");
CREATE UNIQUE INDEX "PartnerAssignment_one_active_per_order" ON "PartnerAssignment"("orderId") WHERE "active" = true;

ALTER TABLE "BranchCapabilityVersion" ADD CONSTRAINT "BranchCapabilityVersion_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchCapabilityVersion" ADD CONSTRAINT "BranchCapabilityVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderMatching" ADD CONSTRAINT "OrderMatching_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerOffer" ADD CONSTRAINT "PartnerOffer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerOffer" ADD CONSTRAINT "PartnerOffer_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerOffer" ADD CONSTRAINT "PartnerOffer_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerOffer" ADD CONSTRAINT "PartnerOffer_capabilityVersionId_fkey" FOREIGN KEY ("capabilityVersionId") REFERENCES "BranchCapabilityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerPayoutSnapshot" ADD CONSTRAINT "PartnerPayoutSnapshot_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "PartnerOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerAssignment" ADD CONSTRAINT "PartnerAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerAssignment" ADD CONSTRAINT "PartnerAssignment_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "PartnerOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerAssignment" ADD CONSTRAINT "PartnerAssignment_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerAssignment" ADD CONSTRAINT "PartnerAssignment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerAssignment" ADD CONSTRAINT "PartnerAssignment_payoutSnapshotId_fkey" FOREIGN KEY ("payoutSnapshotId") REFERENCES "PartnerPayoutSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION agat_reject_immutable_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'immutable stage 6 snapshot';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PartnerPayoutSnapshot_immutable" BEFORE UPDATE OR DELETE ON "PartnerPayoutSnapshot" FOR EACH ROW EXECUTE FUNCTION agat_reject_immutable_update();
