ALTER TYPE "PartnerStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "PartnerStatus" ADD VALUE IF NOT EXISTS 'ACTIVE';
ALTER TYPE "PartnerStatus" ADD VALUE IF NOT EXISTS 'CLOSED';

CREATE TYPE "NetworkVersionStatus" AS ENUM ('ACTIVE', 'RETIRED');
CREATE TYPE "AvailabilityKind" AS ENUM ('AVAILABLE', 'UNAVAILABLE');
CREATE TYPE "CapacityReservationStatus" AS ENUM ('HELD', 'CONSUMED', 'RELEASED');
CREATE TYPE "MatchingReasonCode" AS ENUM (
  'ELIGIBLE', 'PARTNER_NOT_ACTIVE', 'BRANCH_INACTIVE', 'ORDERS_DISABLED',
  'CAPABILITY_MISMATCH', 'SERVICE_DISABLED', 'OUTSIDE_WORKING_HOURS',
  'TEMPORARILY_UNAVAILABLE', 'OUTSIDE_SERVICE_AREA', 'CAPACITY_FULL',
  'STALE_NETWORK_VERSION'
);

ALTER TABLE "Partner"
  ADD COLUMN "publicDescription" VARCHAR(500),
  ADD COLUMN "publicContact" VARCHAR(180),
  ADD COLUMN "operationalContactCiphertext" TEXT,
  ADD COLUMN "operationalContactIv" VARCHAR(24),
  ADD COLUMN "operationalContactAuthTag" VARCHAR(32);

ALTER TABLE "Branch"
  ADD COLUMN "publicDescription" VARCHAR(500),
  ADD COLUMN "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Tashkent',
  ADD COLUMN "latitude" DECIMAL(9,6) NOT NULL DEFAULT 41.311081,
  ADD COLUMN "longitude" DECIMAL(9,6) NOT NULL DEFAULT 69.240562,
  ADD COLUMN "serviceRadiusMeters" INTEGER NOT NULL DEFAULT 25000,
  ADD COLUMN "acceptingOrders" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "BranchCapabilityVersion"
  ADD COLUMN "serviceCodes" TEXT[] NOT NULL DEFAULT ARRAY['DOCUMENT_PRINT']::TEXT[],
  ADD COLUMN "paperCodes" TEXT[] NOT NULL DEFAULT ARRAY['STANDARD']::TEXT[],
  ADD COLUMN "colorModes" TEXT[] NOT NULL DEFAULT ARRAY['COLOR','MONOCHROME']::TEXT[],
  ADD COLUMN "equipmentCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "maxQuantity" INTEGER NOT NULL DEFAULT 1000;

CREATE TABLE "BranchOperationalVersion" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "NetworkVersionStatus" NOT NULL DEFAULT 'ACTIVE',
  "weeklyHours" JSONB NOT NULL,
  "settings" JSONB NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt" TIMESTAMP(3),
  CONSTRAINT "BranchOperationalVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BranchCatalogVersion" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "NetworkVersionStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt" TIMESTAMP(3),
  CONSTRAINT "BranchCatalogVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BranchCatalogItem" (
  "id" UUID NOT NULL,
  "catalogVersionId" UUID NOT NULL,
  "serviceCode" VARCHAR(40) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "paperCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "colorModes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "maxQuantity" INTEGER NOT NULL,
  CONSTRAINT "BranchCatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BranchCapacityVersion" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "NetworkVersionStatus" NOT NULL DEFAULT 'ACTIVE',
  "maxConcurrentOrders" INTEGER NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt" TIMESTAMP(3),
  CONSTRAINT "BranchCapacityVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BranchAvailabilityException" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "kind" "AvailabilityKind" NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "BranchAvailabilityException_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchingCandidateEvaluation" (
  "id" UUID NOT NULL,
  "matchingId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "capabilityVersionId" UUID,
  "operationalVersionId" UUID,
  "catalogVersionId" UUID,
  "capacityVersionId" UUID,
  "evaluationRound" INTEGER NOT NULL DEFAULT 0,
  "reasonCodes" "MatchingReasonCode"[] NOT NULL,
  "eligible" BOOLEAN NOT NULL,
  "candidateRank" INTEGER,
  "priority" INTEGER,
  "distanceMeters" INTEGER,
  "workloadBasisPoints" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchingCandidateEvaluation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PartnerOffer"
  ADD COLUMN "operationalVersionId" UUID,
  ADD COLUMN "catalogVersionId" UUID,
  ADD COLUMN "capacityVersionId" UUID,
  ADD COLUMN "evaluationId" UUID;

CREATE TABLE "OfferCapacityReservation" (
  "id" UUID NOT NULL,
  "offerId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "capacityVersionId" UUID NOT NULL,
  "status" "CapacityReservationStatus" NOT NULL DEFAULT 'HELD',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfferCapacityReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BranchOperationalVersion_branchId_version_key" ON "BranchOperationalVersion"("branchId", "version");
CREATE INDEX "BranchOperationalVersion_branchId_status_idx" ON "BranchOperationalVersion"("branchId", "status");
CREATE UNIQUE INDEX "BranchCatalogVersion_branchId_version_key" ON "BranchCatalogVersion"("branchId", "version");
CREATE INDEX "BranchCatalogVersion_branchId_status_idx" ON "BranchCatalogVersion"("branchId", "status");
CREATE UNIQUE INDEX "BranchCatalogItem_catalogVersionId_serviceCode_key" ON "BranchCatalogItem"("catalogVersionId", "serviceCode");
CREATE UNIQUE INDEX "BranchCapacityVersion_branchId_version_key" ON "BranchCapacityVersion"("branchId", "version");
CREATE INDEX "BranchCapacityVersion_branchId_status_idx" ON "BranchCapacityVersion"("branchId", "status");
CREATE INDEX "BranchAvailabilityException_branchId_startsAt_endsAt_idx" ON "BranchAvailabilityException"("branchId", "startsAt", "endsAt");
CREATE UNIQUE INDEX "MatchingCandidateEvaluation_matchingId_branchId_evaluationRound_key" ON "MatchingCandidateEvaluation"("matchingId", "branchId", "evaluationRound");
CREATE INDEX "MatchingCandidateEvaluation_matchingId_eligible_candidateRank_idx" ON "MatchingCandidateEvaluation"("matchingId", "eligible", "candidateRank");
CREATE UNIQUE INDEX "PartnerOffer_evaluationId_key" ON "PartnerOffer"("evaluationId");
CREATE UNIQUE INDEX "OfferCapacityReservation_offerId_key" ON "OfferCapacityReservation"("offerId");
CREATE INDEX "OfferCapacityReservation_branchId_status_expiresAt_idx" ON "OfferCapacityReservation"("branchId", "status", "expiresAt");

ALTER TABLE "Branch" ADD CONSTRAINT "Branch_serviceRadiusMeters_check" CHECK ("serviceRadiusMeters" BETWEEN 0 AND 200000);
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_coordinates_check" CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180);
ALTER TABLE "BranchCapabilityVersion" ADD CONSTRAINT "BranchCapabilityVersion_maxQuantity_check" CHECK ("maxQuantity" BETWEEN 1 AND 100000);
ALTER TABLE "BranchCatalogItem" ADD CONSTRAINT "BranchCatalogItem_maxQuantity_check" CHECK ("maxQuantity" BETWEEN 1 AND 100000);
ALTER TABLE "BranchCapacityVersion" ADD CONSTRAINT "BranchCapacityVersion_limit_check" CHECK ("maxConcurrentOrders" BETWEEN 1 AND 10000);
ALTER TABLE "BranchAvailabilityException" ADD CONSTRAINT "BranchAvailabilityException_range_check" CHECK ("endsAt" > "startsAt" AND "endsAt" <= "startsAt" + INTERVAL '90 days');

ALTER TABLE "BranchOperationalVersion" ADD CONSTRAINT "BranchOperationalVersion_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchOperationalVersion" ADD CONSTRAINT "BranchOperationalVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchCatalogVersion" ADD CONSTRAINT "BranchCatalogVersion_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchCatalogVersion" ADD CONSTRAINT "BranchCatalogVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchCatalogItem" ADD CONSTRAINT "BranchCatalogItem_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "BranchCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchCapacityVersion" ADD CONSTRAINT "BranchCapacityVersion_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchCapacityVersion" ADD CONSTRAINT "BranchCapacityVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchAvailabilityException" ADD CONSTRAINT "BranchAvailabilityException_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchAvailabilityException" ADD CONSTRAINT "BranchAvailabilityException_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchingCandidateEvaluation" ADD CONSTRAINT "MatchingCandidateEvaluation_matchingId_fkey" FOREIGN KEY ("matchingId") REFERENCES "OrderMatching"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchingCandidateEvaluation" ADD CONSTRAINT "MatchingCandidateEvaluation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchingCandidateEvaluation" ADD CONSTRAINT "MatchingCandidateEvaluation_capabilityVersionId_fkey" FOREIGN KEY ("capabilityVersionId") REFERENCES "BranchCapabilityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchingCandidateEvaluation" ADD CONSTRAINT "MatchingCandidateEvaluation_operationalVersionId_fkey" FOREIGN KEY ("operationalVersionId") REFERENCES "BranchOperationalVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchingCandidateEvaluation" ADD CONSTRAINT "MatchingCandidateEvaluation_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "BranchCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchingCandidateEvaluation" ADD CONSTRAINT "MatchingCandidateEvaluation_capacityVersionId_fkey" FOREIGN KEY ("capacityVersionId") REFERENCES "BranchCapacityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerOffer" ADD CONSTRAINT "PartnerOffer_operationalVersionId_fkey" FOREIGN KEY ("operationalVersionId") REFERENCES "BranchOperationalVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerOffer" ADD CONSTRAINT "PartnerOffer_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "BranchCatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerOffer" ADD CONSTRAINT "PartnerOffer_capacityVersionId_fkey" FOREIGN KEY ("capacityVersionId") REFERENCES "BranchCapacityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerOffer" ADD CONSTRAINT "PartnerOffer_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "MatchingCandidateEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfferCapacityReservation" ADD CONSTRAINT "OfferCapacityReservation_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "PartnerOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfferCapacityReservation" ADD CONSTRAINT "OfferCapacityReservation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfferCapacityReservation" ADD CONSTRAINT "OfferCapacityReservation_capacityVersionId_fkey" FOREIGN KEY ("capacityVersionId") REFERENCES "BranchCapacityVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION agat_reject_network_version_content_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'immutable network version'; END IF;
  IF to_jsonb(NEW) - 'status' - 'retiredAt' IS DISTINCT FROM to_jsonb(OLD) - 'status' - 'retiredAt' THEN
    RAISE EXCEPTION 'immutable network version content';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BranchOperationalVersion_immutable" BEFORE UPDATE OR DELETE ON "BranchOperationalVersion" FOR EACH ROW EXECUTE FUNCTION agat_reject_network_version_content_change();
CREATE TRIGGER "BranchCapabilityVersion_content_immutable" BEFORE UPDATE OR DELETE ON "BranchCapabilityVersion" FOR EACH ROW EXECUTE FUNCTION agat_reject_network_version_content_change();
CREATE TRIGGER "BranchCatalogVersion_immutable" BEFORE UPDATE OR DELETE ON "BranchCatalogVersion" FOR EACH ROW EXECUTE FUNCTION agat_reject_network_version_content_change();
CREATE TRIGGER "BranchCapacityVersion_immutable" BEFORE UPDATE OR DELETE ON "BranchCapacityVersion" FOR EACH ROW EXECUTE FUNCTION agat_reject_network_version_content_change();
CREATE TRIGGER "BranchCatalogItem_immutable" BEFORE UPDATE OR DELETE ON "BranchCatalogItem" FOR EACH ROW EXECUTE FUNCTION agat_reject_immutable_update();
CREATE TRIGGER "MatchingCandidateEvaluation_immutable" BEFORE UPDATE OR DELETE ON "MatchingCandidateEvaluation" FOR EACH ROW EXECUTE FUNCTION agat_reject_immutable_update();
