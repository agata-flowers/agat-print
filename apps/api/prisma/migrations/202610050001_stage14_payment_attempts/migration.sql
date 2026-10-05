ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'UNKNOWN';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'CANCELLED');
CREATE TYPE "PaymentMethodKind" AS ENUM ('INTERNAL_MVP', 'PROVIDER_REDIRECT');
CREATE TYPE "PaymentScenario" AS ENUM ('SUCCESS', 'FAILURE', 'RETRY', 'DUPLICATE', 'TIMEOUT');
CREATE TYPE "PaymentEventDisposition" AS ENUM ('APPLIED', 'DUPLICATE', 'OUT_OF_ORDER', 'IGNORED_UNKNOWN', 'RECONCILIATION_REQUIRED');

ALTER TABLE "Payment" ADD COLUMN "lastFailureCode" VARCHAR(40);
ALTER TABLE "Payment" ADD COLUMN "nextReconcileAt" TIMESTAMP(3);

CREATE TABLE "PaymentAttempt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "paymentId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "method" "PaymentMethodKind" NOT NULL,
  "scenario" "PaymentScenario",
  "provider" VARCHAR(30) NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "snapshotDigest" CHAR(64) NOT NULL,
  "merchantReference" VARCHAR(80) NOT NULL,
  "providerReferenceCiphertext" TEXT,
  "providerReferenceDigest" CHAR(64),
  "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
  "version" INTEGER NOT NULL DEFAULT 0,
  "failureCode" VARCHAR(40),
  "expiresAt" TIMESTAMP(3),
  "nextReconcileAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentAttempt_amount_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "PaymentAttempt_currency_check" CHECK ("currency" = 'UZS')
);

CREATE UNIQUE INDEX "PaymentAttempt_paymentId_sequence_key" ON "PaymentAttempt"("paymentId", "sequence");
CREATE UNIQUE INDEX "PaymentAttempt_merchantReference_key" ON "PaymentAttempt"("merchantReference");
CREATE UNIQUE INDEX "PaymentAttempt_providerReferenceDigest_key" ON "PaymentAttempt"("providerReferenceDigest");
CREATE UNIQUE INDEX "PaymentAttempt_one_unresolved" ON "PaymentAttempt"("paymentId") WHERE "status" IN ('CREATED', 'PROCESSING', 'UNKNOWN');
CREATE INDEX "PaymentAttempt_paymentId_createdAt_idx" ON "PaymentAttempt"("paymentId", "createdAt");
CREATE INDEX "PaymentAttempt_status_nextReconcileAt_idx" ON "PaymentAttempt"("status", "nextReconcileAt");
CREATE INDEX "Payment_status_nextReconcileAt_idx" ON "Payment"("status", "nextReconcileAt");

ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderCallback" ADD COLUMN "paymentAttemptId" UUID;
ALTER TABLE "ProviderCallback" ADD COLUMN "eventType" VARCHAR(40) NOT NULL DEFAULT 'LEGACY';
ALTER TABLE "ProviderCallback" ADD COLUMN "disposition" "PaymentEventDisposition" NOT NULL DEFAULT 'APPLIED';
ALTER TABLE "ProviderCallback" ADD COLUMN "resultCode" VARCHAR(40) NOT NULL DEFAULT 'LEGACY';
ALTER TABLE "ProviderCallback" ADD COLUMN "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ProviderCallback" ADD CONSTRAINT "ProviderCallback_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ProviderCallback_paymentAttemptId_createdAt_idx" ON "ProviderCallback"("paymentAttemptId", "createdAt");
CREATE INDEX "ProviderCallback_disposition_createdAt_idx" ON "ProviderCallback"("disposition", "createdAt");

INSERT INTO "PaymentAttempt" (
  "paymentId", "sequence", "method", "provider", "amountMinor", "currency",
  "snapshotDigest", "merchantReference", "providerReferenceDigest", "status",
  "version", "createdAt", "startedAt", "completedAt"
)
SELECT
  p.id, 1,
  CASE WHEN p.provider = 'mock' THEN 'INTERNAL_MVP'::"PaymentMethodKind" ELSE 'PROVIDER_REDIRECT'::"PaymentMethodKind" END,
  p.provider, p."amountMinor", p.currency,
  encode(digest(p."orderId"::text || ':' || p."amountMinor"::text || ':' || p.currency, 'sha256'), 'hex'),
  'legacy-' || p.id::text,
  encode(digest(p."providerPaymentReference", 'sha256'), 'hex'),
  CASE
    WHEN p.status = 'PENDING' THEN 'PROCESSING'::"PaymentAttemptStatus"
    WHEN p.status = 'FAILED' THEN 'FAILED'::"PaymentAttemptStatus"
    ELSE 'SUCCEEDED'::"PaymentAttemptStatus"
  END,
  p.version, p."createdAt", p."createdAt",
  CASE WHEN p.status IN ('PENDING', 'REFUND_PENDING') THEN NULL ELSE p."updatedAt" END
FROM "Payment" p
WHERE p."providerPaymentReference" IS NOT NULL
ON CONFLICT ("merchantReference") DO NOTHING;

CREATE FUNCTION agat_payment_attempt_source_immutable() RETURNS trigger AS $$
BEGIN
  IF (NEW."paymentId", NEW.sequence, NEW.method, NEW.scenario, NEW.provider, NEW."amountMinor", NEW.currency, NEW."snapshotDigest", NEW."merchantReference", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."paymentId", OLD.sequence, OLD.method, OLD.scenario, OLD.provider, OLD."amountMinor", OLD.currency, OLD."snapshotDigest", OLD."merchantReference", OLD."createdAt") THEN
    RAISE EXCEPTION 'payment attempt source fields are immutable';
  END IF;
  IF OLD."providerReferenceDigest" IS NOT NULL AND
     (NEW."providerReferenceDigest", NEW."providerReferenceCiphertext") IS DISTINCT FROM
     (OLD."providerReferenceDigest", OLD."providerReferenceCiphertext") THEN
    RAISE EXCEPTION 'payment attempt provider reference is immutable once assigned';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentAttempt_source_immutable" BEFORE UPDATE ON "PaymentAttempt"
FOR EACH ROW EXECUTE FUNCTION agat_payment_attempt_source_immutable();

CREATE FUNCTION agat_payment_source_immutable() RETURNS trigger AS $$
BEGIN
  IF (NEW."orderId", NEW."amountMinor", NEW.currency, NEW."createdAt")
     IS DISTINCT FROM
     (OLD."orderId", OLD."amountMinor", OLD.currency, OLD."createdAt") THEN
    RAISE EXCEPTION 'payment source fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Payment_source_immutable" BEFORE UPDATE ON "Payment"
FOR EACH ROW EXECUTE FUNCTION agat_payment_source_immutable();
