INSERT INTO "UserRole" ("userId", role, "createdAt")
SELECT "userId", 'FINANCE_ADMIN', CURRENT_TIMESTAMP FROM "UserRole" WHERE role = 'ADMIN'
ON CONFLICT DO NOTHING;

CREATE TYPE "FinancialJobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'DEAD_LETTER');
CREATE TYPE "FiscalOperationType" AS ENUM ('SALE', 'REFUND');
CREATE TYPE "FiscalOperationStatus" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'RETRY_PENDING', 'RECONCILIATION_REQUIRED');
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "LedgerEntryType" AS ENUM ('EARNING', 'REFUND_ADJUSTMENT');
CREATE TYPE "SettlementBatchStatus" AS ENUM ('CREATED', 'SUBMITTED', 'SETTLED', 'RETRY_PENDING', 'RECONCILIATION_REQUIRED');
CREATE TYPE "ReconciliationKind" AS ENUM ('PAYMENT', 'FISCAL', 'PAYOUT');
CREATE TYPE "ReconciliationStatus" AS ENUM ('MATCHED', 'MISMATCH', 'RESOLVED');

CREATE TABLE "FinancialJob" (
  "dedupKey" CHAR(64) PRIMARY KEY,
  "eventId" UUID NOT NULL UNIQUE,
  "status" "FinancialJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseUntil" TIMESTAMP(3),
  "leaseOwner" UUID,
  "lastErrorCode" VARCHAR(40),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3)
);
CREATE INDEX "FinancialJob_status_leaseUntil_idx" ON "FinancialJob"("status", "leaseUntil");

CREATE TABLE "FiscalOperation" (
  "id" UUID PRIMARY KEY,
  "orderId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "refundId" UUID UNIQUE,
  "type" "FiscalOperationType" NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "status" "FiscalOperationStatus" NOT NULL DEFAULT 'PENDING',
  "dedupKey" CHAR(64) NOT NULL UNIQUE,
  "providerReference" VARCHAR(160) UNIQUE,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(40),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "FiscalOperation_money_check" CHECK ("amountMinor" > 0 AND currency = 'UZS'),
  CONSTRAINT "FiscalOperation_source_check" CHECK ((type = 'SALE' AND "refundId" IS NULL) OR (type = 'REFUND' AND "refundId" IS NOT NULL))
);
CREATE UNIQUE INDEX "FiscalOperation_one_sale_per_payment" ON "FiscalOperation"("paymentId") WHERE type = 'SALE';
CREATE INDEX "FiscalOperation_status_nextAttemptAt_idx" ON "FiscalOperation"("status", "nextAttemptAt");
CREATE INDEX "FiscalOperation_orderId_createdAt_idx" ON "FiscalOperation"("orderId", "createdAt");

CREATE TABLE "FiscalReceipt" (
  "id" UUID PRIMARY KEY,
  "fiscalOperationId" UUID NOT NULL UNIQUE,
  "providerReceiptDigest" CHAR(64) NOT NULL,
  "fiscalSignDigest" CHAR(64),
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "PartnerLedgerEntry" (
  "id" UUID PRIMARY KEY,
  "orderId" UUID NOT NULL,
  "assignmentId" UUID NOT NULL,
  "payoutSnapshotId" UUID NOT NULL,
  "refundId" UUID UNIQUE,
  "type" "LedgerEntryType" NOT NULL,
  "direction" "LedgerDirection" NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "dedupKey" CHAR(64) NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerLedgerEntry_money_check" CHECK ("amountMinor" > 0 AND currency = 'UZS'),
  CONSTRAINT "PartnerLedgerEntry_kind_check" CHECK (
    (type = 'EARNING' AND direction = 'CREDIT' AND "refundId" IS NULL) OR
    (type = 'REFUND_ADJUSTMENT' AND direction = 'DEBIT' AND "refundId" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "PartnerLedgerEntry_one_earning_per_order" ON "PartnerLedgerEntry"("orderId") WHERE type = 'EARNING';
CREATE INDEX "PartnerLedgerEntry_assignmentId_createdAt_idx" ON "PartnerLedgerEntry"("assignmentId", "createdAt");
CREATE INDEX "PartnerLedgerEntry_orderId_createdAt_idx" ON "PartnerLedgerEntry"("orderId", "createdAt");

CREATE OR REPLACE FUNCTION agat_validate_partner_ledger() RETURNS trigger AS $$
DECLARE snapshot RECORD;
DECLARE debited BIGINT;
BEGIN
  SELECT * INTO snapshot FROM "PartnerPayoutSnapshot" WHERE id = NEW."payoutSnapshotId";
  IF snapshot IS NULL OR snapshot.currency <> NEW.currency THEN
    RAISE EXCEPTION 'partner ledger source mismatch';
  END IF;
  IF NEW.type = 'EARNING' AND NEW."amountMinor" <> snapshot."partnerPayoutMinor" THEN
    RAISE EXCEPTION 'partner earning must equal payout snapshot';
  END IF;
  IF NEW.direction = 'DEBIT' THEN
    SELECT COALESCE(sum("amountMinor"), 0) INTO debited FROM "PartnerLedgerEntry"
      WHERE "orderId" = NEW."orderId" AND direction = 'DEBIT';
    IF debited + NEW."amountMinor" > snapshot."partnerPayoutMinor" THEN
      RAISE EXCEPTION 'partner refund adjustments exceed payout snapshot';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PartnerLedgerEntry_validate" BEFORE INSERT ON "PartnerLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION agat_validate_partner_ledger();

CREATE TABLE "SettlementBatch" (
  "id" UUID PRIMARY KEY,
  "partnerId" UUID NOT NULL,
  "sequence" SERIAL NOT NULL UNIQUE,
  "currency" CHAR(3) NOT NULL,
  "status" "SettlementBatchStatus" NOT NULL DEFAULT 'CREATED',
  "cutoffAt" TIMESTAMP(3) NOT NULL,
  "totalMinor" BIGINT NOT NULL,
  "dedupKey" CHAR(64) NOT NULL UNIQUE,
  "providerReference" VARCHAR(160) UNIQUE,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(40),
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  CONSTRAINT "SettlementBatch_money_check" CHECK ("totalMinor" >= 0 AND currency = 'UZS')
);
CREATE INDEX "SettlementBatch_status_nextAttemptAt_idx" ON "SettlementBatch"("status", "nextAttemptAt");
CREATE INDEX "SettlementBatch_partnerId_createdAt_idx" ON "SettlementBatch"("partnerId", "createdAt");

CREATE TABLE "SettlementBatchItem" (
  "batchId" UUID NOT NULL,
  "ledgerEntryId" UUID NOT NULL UNIQUE,
  "amountMinor" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("batchId", "ledgerEntryId"),
  CONSTRAINT "SettlementBatchItem_amount_check" CHECK ("amountMinor" > 0)
);

CREATE OR REPLACE FUNCTION agat_validate_settlement_item() RETURNS trigger AS $$
DECLARE entry RECORD;
BEGIN
  SELECT * INTO entry FROM "PartnerLedgerEntry" WHERE id = NEW."ledgerEntryId";
  IF entry IS NULL OR NEW."amountMinor" <> entry."amountMinor" THEN
    RAISE EXCEPTION 'invalid settlement ledger entry';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SettlementBatchItem_validate" BEFORE INSERT ON "SettlementBatchItem"
FOR EACH ROW EXECUTE FUNCTION agat_validate_settlement_item();

CREATE OR REPLACE FUNCTION agat_validate_settlement_balance() RETURNS trigger AS $$
DECLARE batch RECORD;
DECLARE calculated BIGINT;
DECLARE wrong_partner BIGINT;
BEGIN
  SELECT * INTO batch FROM "SettlementBatch" WHERE id = NEW."batchId";
  SELECT COALESCE(sum(CASE WHEN e.direction = 'CREDIT' THEN i."amountMinor" ELSE -i."amountMinor" END), 0),
         count(*) FILTER (WHERE a."partnerId" <> batch."partnerId")
    INTO calculated, wrong_partner
    FROM "SettlementBatchItem" i
    JOIN "PartnerLedgerEntry" e ON e.id = i."ledgerEntryId"
    JOIN "PartnerAssignment" a ON a.id = e."assignmentId"
    WHERE i."batchId" = NEW."batchId";
  IF wrong_partner <> 0 OR calculated <> batch."totalMinor" OR calculated <= 0 THEN
    RAISE EXCEPTION 'settlement batch balance mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "SettlementBatch_balance_validate"
AFTER INSERT ON "SettlementBatchItem" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION agat_validate_settlement_balance();

CREATE TABLE "FinancialReconciliation" (
  "id" UUID PRIMARY KEY,
  "kind" "ReconciliationKind" NOT NULL,
  "entityId" UUID NOT NULL,
  "runKeyDigest" CHAR(64) NOT NULL,
  "expectedStatus" VARCHAR(40) NOT NULL,
  "observedStatus" VARCHAR(40) NOT NULL,
  "status" "ReconciliationStatus" NOT NULL,
  "detailCode" VARCHAR(40),
  "actorId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  UNIQUE (kind, "entityId", "runKeyDigest")
);
CREATE INDEX "FinancialReconciliation_status_createdAt_idx" ON "FinancialReconciliation"(status, "createdAt");

ALTER TABLE "FiscalOperation" ADD FOREIGN KEY ("orderId") REFERENCES "Order"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FiscalOperation" ADD FOREIGN KEY ("paymentId") REFERENCES "Payment"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FiscalOperation" ADD FOREIGN KEY ("refundId") REFERENCES "RefundOperation"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FiscalReceipt" ADD FOREIGN KEY ("fiscalOperationId") REFERENCES "FiscalOperation"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerLedgerEntry" ADD FOREIGN KEY ("orderId") REFERENCES "Order"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerLedgerEntry" ADD FOREIGN KEY ("assignmentId") REFERENCES "PartnerAssignment"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerLedgerEntry" ADD FOREIGN KEY ("payoutSnapshotId") REFERENCES "PartnerPayoutSnapshot"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerLedgerEntry" ADD FOREIGN KEY ("refundId") REFERENCES "RefundOperation"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementBatch" ADD FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementBatch" ADD FOREIGN KEY ("partnerId") REFERENCES "Partner"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementBatchItem" ADD FOREIGN KEY ("batchId") REFERENCES "SettlementBatch"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementBatchItem" ADD FOREIGN KEY ("ledgerEntryId") REFERENCES "PartnerLedgerEntry"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialReconciliation" ADD FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "FiscalReceipt_immutable" BEFORE UPDATE OR DELETE ON "FiscalReceipt" FOR EACH ROW EXECUTE FUNCTION agat_reject_immutable_update();
CREATE TRIGGER "PartnerLedgerEntry_immutable" BEFORE UPDATE OR DELETE ON "PartnerLedgerEntry" FOR EACH ROW EXECUTE FUNCTION agat_reject_immutable_update();
CREATE TRIGGER "SettlementBatchItem_immutable" BEFORE UPDATE OR DELETE ON "SettlementBatchItem" FOR EACH ROW EXECUTE FUNCTION agat_reject_immutable_update();
CREATE TRIGGER "FinancialReconciliation_immutable" BEFORE UPDATE OR DELETE ON "FinancialReconciliation" FOR EACH ROW EXECUTE FUNCTION agat_reject_immutable_update();

CREATE OR REPLACE FUNCTION agat_guard_fiscal_operation() RETURNS trigger AS $$
BEGIN
  IF OLD."orderId" <> NEW."orderId" OR OLD."paymentId" <> NEW."paymentId" OR
     OLD."refundId" IS DISTINCT FROM NEW."refundId" OR OLD.type <> NEW.type OR
     OLD."amountMinor" <> NEW."amountMinor" OR OLD.currency <> NEW.currency OR
     OLD."dedupKey" <> NEW."dedupKey" OR OLD."createdAt" <> NEW."createdAt" THEN
    RAISE EXCEPTION 'fiscal source fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FiscalOperation_source_immutable" BEFORE UPDATE ON "FiscalOperation"
FOR EACH ROW EXECUTE FUNCTION agat_guard_fiscal_operation();

CREATE OR REPLACE FUNCTION agat_guard_settlement_batch() RETURNS trigger AS $$
BEGIN
  IF OLD."partnerId" <> NEW."partnerId" OR OLD.currency <> NEW.currency OR OLD."cutoffAt" <> NEW."cutoffAt" OR
     OLD."totalMinor" <> NEW."totalMinor" OR OLD."dedupKey" <> NEW."dedupKey" OR
     OLD."createdById" <> NEW."createdById" OR OLD."createdAt" <> NEW."createdAt" THEN
    RAISE EXCEPTION 'settlement source fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SettlementBatch_source_immutable" BEFORE UPDATE ON "SettlementBatch"
FOR EACH ROW EXECUTE FUNCTION agat_guard_settlement_batch();
