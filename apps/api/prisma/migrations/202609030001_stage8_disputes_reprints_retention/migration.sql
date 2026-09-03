CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DISPUTED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'REPRINT';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_REFUNDED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_REFUNDED';

CREATE TYPE "DisputeCategory" AS ENUM ('PRINT_QUALITY', 'WRONG_OUTPUT', 'DAMAGED', 'MISSING_ITEMS', 'DELIVERY_FAILURE');
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'PARTNER_RESPONDED', 'RESOLVED', 'CANCELLED');
CREATE TYPE "DisputeResolutionType" AS ENUM ('NO_ACTION', 'REPRINT', 'PARTIAL_REFUND', 'FULL_REFUND');
CREATE TYPE "ProductionCycleKind" AS ENUM ('ORIGINAL', 'REPRINT');
CREATE TYPE "ProductionCycleStatus" AS ENUM ('CREATED', 'IN_PRODUCTION', 'READY', 'FULFILLING', 'COMPLETED', 'FAILED');
CREATE TYPE "RefundKind" AS ENUM ('FULL', 'PARTIAL');
CREATE TYPE "RetentionScheduleStatus" AS ENUM ('ACTIVE', 'HELD', 'SUPERSEDED', 'COMPLETED');
CREATE TYPE "TombstoneApplyStatus" AS ENUM ('PENDING', 'APPLIED');
CREATE TYPE "AftercareJobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'DEAD_LETTER');
CREATE TABLE "AftercareJob" (
  "dedupKey" CHAR(64) PRIMARY KEY, "eventId" UUID NOT NULL,
  "status" "AftercareJobStatus" NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseUntil" TIMESTAMP(3), "leaseOwner" UUID, "lastErrorCode" VARCHAR(40),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "AftercareJob_eventId_key" ON "AftercareJob"("eventId");
CREATE INDEX "AftercareJob_status_leaseUntil_idx" ON "AftercareJob"("status", "leaseUntil");

ALTER TABLE "Order" ADD COLUMN "disputeEligibleAt" TIMESTAMP(3);
UPDATE "Order" SET "disputeEligibleAt" = "updatedAt" WHERE status IN ('COMPLETED', 'DELIVERY_FAILED');

ALTER TABLE "RetentionTombstone"
  ADD COLUMN "applyStatus" "TombstoneApplyStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "appliedAt" TIMESTAMP(3),
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseUntil" TIMESTAMP(3),
  ADD COLUMN "lastErrorCode" VARCHAR(80);

ALTER TABLE "RefundOperation"
  DROP CONSTRAINT IF EXISTS "RefundOperation_paymentId_key",
  ADD COLUMN "disputeId" UUID,
  ADD COLUMN "kind" "RefundKind" NOT NULL DEFAULT 'FULL';
DROP INDEX IF EXISTS "RefundOperation_paymentId_key";
CREATE INDEX "RefundOperation_paymentId_status_idx" ON "RefundOperation"("paymentId", "status");
CREATE UNIQUE INDEX "RefundOperation_disputeId_key" ON "RefundOperation"("disputeId");

CREATE TABLE "DisputeCase" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "openedById" UUID NOT NULL,
  "category" "DisputeCategory" NOT NULL,
  "structuredComment" VARCHAR(280),
  "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
  "openedFromStatus" "OrderStatus" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "DisputeCase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DisputeCase_orderId_sequence_key" ON "DisputeCase"("orderId", "sequence");
CREATE UNIQUE INDEX "DisputeCase_one_active_per_order" ON "DisputeCase"("orderId") WHERE "status" IN ('OPEN', 'PARTNER_RESPONDED');
CREATE INDEX "DisputeCase_orderId_status_idx" ON "DisputeCase"("orderId", "status");
CREATE INDEX "DisputeCase_status_createdAt_idx" ON "DisputeCase"("status", "createdAt");

CREATE TABLE "DisputeResponse" (
  "id" UUID NOT NULL,
  "disputeId" UUID NOT NULL,
  "responderId" UUID NOT NULL,
  "responseCode" VARCHAR(40) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisputeResponse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DisputeResponse_disputeId_responderId_key" ON "DisputeResponse"("disputeId", "responderId");

CREATE TABLE "DisputeResolution" (
  "id" UUID NOT NULL,
  "disputeId" UUID NOT NULL,
  "resolverId" UUID NOT NULL,
  "type" "DisputeResolutionType" NOT NULL,
  "refundAmountMinor" BIGINT,
  "currency" CHAR(3),
  "ruleVersion" VARCHAR(40) NOT NULL,
  "allocationInputs" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisputeResolution_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DisputeResolution_disputeId_key" ON "DisputeResolution"("disputeId");

CREATE TABLE "ProductionCycle" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "kind" "ProductionCycleKind" NOT NULL,
  "status" "ProductionCycleStatus" NOT NULL DEFAULT 'CREATED',
  "printReadyVersionId" UUID NOT NULL,
  "assignmentId" UUID NOT NULL,
  "resolutionId" UUID,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ProductionCycle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductionCycle_orderId_sequence_key" ON "ProductionCycle"("orderId", "sequence");
CREATE UNIQUE INDEX "ProductionCycle_resolutionId_key" ON "ProductionCycle"("resolutionId");
CREATE INDEX "ProductionCycle_orderId_status_idx" ON "ProductionCycle"("orderId", "status");

INSERT INTO "ProductionCycle" ("id", "orderId", "sequence", "kind", "status", "printReadyVersionId", "assignmentId", "version", "createdAt", "completedAt")
SELECT gen_random_uuid(), o."id", 1, 'ORIGINAL',
  CASE
    WHEN o."status" = 'COMPLETED' THEN 'COMPLETED'::"ProductionCycleStatus"
    WHEN o."status" = 'DELIVERY_FAILED' THEN 'FAILED'::"ProductionCycleStatus"
    WHEN o."status" = 'READY' THEN 'READY'::"ProductionCycleStatus"
    WHEN o."status" IN ('AWAITING_PICKUP','COURIER_ASSIGNED','IN_DELIVERY') THEN 'FULFILLING'::"ProductionCycleStatus"
    WHEN o."status" = 'IN_PRODUCTION' THEN 'IN_PRODUCTION'::"ProductionCycleStatus"
    ELSE 'CREATED'::"ProductionCycleStatus"
  END,
  o."printReadyVersionId", a."id", 0, a."acceptedAt",
  CASE WHEN o."status" = 'COMPLETED' THEN o."updatedAt" ELSE NULL END
FROM "Order" o JOIN LATERAL (
  SELECT * FROM "PartnerAssignment" a WHERE a."orderId" = o."id"
  ORDER BY a."acceptedAt" DESC, a.id DESC LIMIT 1
) a ON true;

ALTER TABLE "PrintJob" ADD COLUMN "productionCycleId" UUID;
UPDATE "PrintJob" j SET "productionCycleId" = c."id" FROM "ProductionCycle" c WHERE c."orderId" = j."orderId" AND c."sequence" = 1;
ALTER TABLE "PrintJob" ALTER COLUMN "productionCycleId" SET NOT NULL;
DROP INDEX IF EXISTS "PrintJob_orderId_key";
DROP INDEX IF EXISTS "PrintJob_assignmentId_key";
CREATE UNIQUE INDEX "PrintJob_productionCycleId_key" ON "PrintJob"("productionCycleId");

ALTER TABLE "OrderFulfillment" ADD COLUMN "productionCycleId" UUID;
UPDATE "OrderFulfillment" f SET "productionCycleId" = c."id" FROM "ProductionCycle" c WHERE c."orderId" = f."orderId" AND c."sequence" = 1;
ALTER TABLE "OrderFulfillment" ALTER COLUMN "productionCycleId" SET NOT NULL;
DROP INDEX IF EXISTS "OrderFulfillment_orderId_key";
DROP INDEX IF EXISTS "OrderFulfillment_orderId_requestKeyDigest_key";
CREATE UNIQUE INDEX "OrderFulfillment_productionCycleId_key" ON "OrderFulfillment"("productionCycleId");
CREATE UNIQUE INDEX "OrderFulfillment_productionCycleId_requestKeyDigest_key" ON "OrderFulfillment"("productionCycleId", "requestKeyDigest");

DROP INDEX IF EXISTS "DeliveryTask_orderId_key";

CREATE TABLE "RetentionPolicy" (
  "id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "originalDays" INTEGER NOT NULL,
  "derivativeDays" INTEGER NOT NULL,
  "auditDays" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RetentionPolicy_version_key" ON "RetentionPolicy"("version");
CREATE UNIQUE INDEX "RetentionPolicy_one_active" ON "RetentionPolicy"("active") WHERE "active" = true;
INSERT INTO "RetentionPolicy" ("id", "version", "originalDays", "derivativeDays", "auditDays") VALUES (gen_random_uuid(), 1, 7, 30, 90);

CREATE TABLE "RetentionSchedule" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "policyId" UUID NOT NULL,
  "terminalVersion" INTEGER NOT NULL,
  "status" "RetentionScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
  "terminalAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "RetentionSchedule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RetentionSchedule_orderId_terminalVersion_key" ON "RetentionSchedule"("orderId", "terminalVersion");
CREATE INDEX "RetentionSchedule_status_terminalAt_idx" ON "RetentionSchedule"("status", "terminalAt");

CREATE TABLE "RetentionScheduleObject" (
  "scheduleId" UUID NOT NULL,
  "objectKey" VARCHAR(1024) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RetentionScheduleObject_pkey" PRIMARY KEY ("scheduleId", "objectKey")
);
CREATE INDEX "RetentionScheduleObject_expiresAt_idx" ON "RetentionScheduleObject"("expiresAt");

CREATE TABLE "LegalHold" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "disputeId" UUID,
  "reasonCode" VARCHAR(40) NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedById" UUID,
  "releasedAt" TIMESTAMP(3),
  CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalHold_disputeId_key" ON "LegalHold"("disputeId");
CREATE INDEX "LegalHold_orderId_releasedAt_idx" ON "LegalHold"("orderId", "releasedAt");

ALTER TABLE "RefundOperation" ADD CONSTRAINT "RefundOperation_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "DisputeCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DisputeResponse" ADD CONSTRAINT "DisputeResponse_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "DisputeCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DisputeResponse" ADD CONSTRAINT "DisputeResponse_responderId_fkey" FOREIGN KEY ("responderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DisputeResolution" ADD CONSTRAINT "DisputeResolution_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "DisputeCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DisputeResolution" ADD CONSTRAINT "DisputeResolution_resolverId_fkey" FOREIGN KEY ("resolverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionCycle" ADD CONSTRAINT "ProductionCycle_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionCycle" ADD CONSTRAINT "ProductionCycle_printReadyVersionId_fkey" FOREIGN KEY ("printReadyVersionId") REFERENCES "PrintReadyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionCycle" ADD CONSTRAINT "ProductionCycle_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "PartnerAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionCycle" ADD CONSTRAINT "ProductionCycle_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "DisputeResolution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_productionCycleId_fkey" FOREIGN KEY ("productionCycleId") REFERENCES "ProductionCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderFulfillment" ADD CONSTRAINT "OrderFulfillment_productionCycleId_fkey" FOREIGN KEY ("productionCycleId") REFERENCES "ProductionCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetentionSchedule" ADD CONSTRAINT "RetentionSchedule_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetentionSchedule" ADD CONSTRAINT "RetentionSchedule_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "RetentionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetentionScheduleObject" ADD CONSTRAINT "RetentionScheduleObject_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RetentionSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetentionScheduleObject" ADD CONSTRAINT "RetentionScheduleObject_objectKey_fkey" FOREIGN KEY ("objectKey") REFERENCES "PermanentObjectReference"("objectKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "DisputeCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "DisputeResolution_immutable" BEFORE UPDATE OR DELETE ON "DisputeResolution" FOR EACH ROW EXECUTE FUNCTION agat_reject_immutable_update();
CREATE TRIGGER "PriceSnapshot_immutable" BEFORE UPDATE OR DELETE ON "PriceSnapshot" FOR EACH ROW EXECUTE FUNCTION agat_reject_immutable_update();
CREATE TRIGGER "DisputeResponse_immutable" BEFORE UPDATE OR DELETE ON "DisputeResponse" FOR EACH ROW EXECUTE FUNCTION agat_reject_immutable_update();

ALTER TABLE "DisputeResolution" ADD CONSTRAINT "DisputeResolution_amount_check" CHECK (
  (type IN ('NO_ACTION','REPRINT') AND "refundAmountMinor" IS NULL AND currency IS NULL) OR
  (type IN ('PARTIAL_REFUND','FULL_REFUND') AND "refundAmountMinor" > 0 AND currency = 'UZS')
);

CREATE OR REPLACE FUNCTION agat_validate_refund_total() RETURNS trigger AS $$
DECLARE paid BIGINT; reserved BIGINT; payment_status TEXT;
BEGIN
  SELECT "amountMinor", status::text INTO paid, payment_status FROM "Payment" WHERE "id" = NEW."paymentId" FOR UPDATE;
  IF TG_OP = 'INSERT' AND payment_status NOT IN ('SUCCEEDED','PARTIALLY_REFUNDED') THEN RAISE EXCEPTION 'payment not settled'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."paymentId", NEW."amountMinor", NEW."triggerDedupKey", NEW.kind, NEW."disputeId") IS DISTINCT FROM (OLD."paymentId", OLD."amountMinor", OLD."triggerDedupKey", OLD.kind, OLD."disputeId") THEN RAISE EXCEPTION 'immutable refund terms'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'CONFIRMED' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'confirmed refund is immutable'; END IF;
  IF NEW."amountMinor" <= 0 THEN RAISE EXCEPTION 'refund amount must be positive'; END IF;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO reserved FROM "RefundOperation" WHERE "paymentId" = NEW."paymentId" AND "id" <> NEW."id";
  IF reserved + NEW."amountMinor" > paid THEN RAISE EXCEPTION 'refund amount exceeds payment'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "RefundOperation_total_guard" BEFORE INSERT OR UPDATE ON "RefundOperation" FOR EACH ROW EXECUTE FUNCTION agat_validate_refund_total();

-- A cycle may advance operational state but never change its source/assignment.
CREATE FUNCTION agat_validate_production_cycle() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."orderId", NEW.sequence, NEW.kind, NEW."printReadyVersionId", NEW."assignmentId", NEW."resolutionId") IS DISTINCT FROM (OLD."orderId", OLD.sequence, OLD.kind, OLD."printReadyVersionId", OLD."assignmentId", OLD."resolutionId") THEN
    RAISE EXCEPTION 'immutable production lineage';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Order" o JOIN "PartnerAssignment" a ON a."orderId" = o.id WHERE o.id = NEW."orderId" AND o."printReadyVersionId" = NEW."printReadyVersionId" AND a.id = NEW."assignmentId") THEN
    RAISE EXCEPTION 'production cycle lineage mismatch';
  END IF;
  IF NEW.kind = 'REPRINT' AND NOT EXISTS (SELECT 1 FROM "DisputeResolution" r JOIN "DisputeCase" d ON d.id = r."disputeId" WHERE r.id = NEW."resolutionId" AND r.type = 'REPRINT' AND d."orderId" = NEW."orderId") THEN
    RAISE EXCEPTION 'reprint resolution mismatch';
  END IF;
  IF NEW.kind = 'ORIGINAL' AND (NEW.sequence <> 1 OR NEW."resolutionId" IS NOT NULL) THEN RAISE EXCEPTION 'invalid original cycle'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ProductionCycle_lineage_guard" BEFORE INSERT OR UPDATE ON "ProductionCycle" FOR EACH ROW EXECUTE FUNCTION agat_validate_production_cycle();
