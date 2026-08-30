CREATE TYPE "TariffStatus" AS ENUM ('ACTIVE', 'RETIRED');
CREATE TYPE "OrderStatus" AS ENUM ('AWAITING_PAYMENT', 'PAID', 'REFUND_PENDING', 'REFUNDED');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUND_PENDING', 'REFUNDED');
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'CONFIRMED');

CREATE TABLE "TariffVersion" (
  "id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "TariffStatus" NOT NULL DEFAULT 'ACTIVE',
  "currency" CHAR(3) NOT NULL DEFAULT 'UZS',
  "basePriceMinor" BIGINT NOT NULL,
  "perPagePriceMinor" BIGINT NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt" TIMESTAMP(3),
  CONSTRAINT "TariffVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Order" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "layoutId" UUID NOT NULL,
  "layoutApprovalId" UUID NOT NULL,
  "printReadyVersionId" UUID NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceSnapshot" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "tariffVersionId" UUID NOT NULL,
  "tariffVersion" INTEGER NOT NULL,
  "sourceParameters" JSONB NOT NULL,
  "lineItems" JSONB NOT NULL,
  "quantity" INTEGER NOT NULL,
  "subtotalMinor" BIGINT NOT NULL,
  "discountMinor" BIGINT NOT NULL DEFAULT 0,
  "totalMinor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payment" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "provider" VARCHAR(30) NOT NULL,
  "providerPaymentReference" VARCHAR(160),
  "amountMinor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RefundOperation" (
  "id" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "triggerDedupKey" CHAR(64) NOT NULL,
  "providerRefundReference" VARCHAR(160),
  "amountMinor" BIGINT NOT NULL,
  "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "RefundOperation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdempotencyRecord" (
  "id" UUID NOT NULL,
  "scope" VARCHAR(80) NOT NULL,
  "keyDigest" CHAR(64) NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "response" JSONB NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderCallback" (
  "id" UUID NOT NULL,
  "provider" VARCHAR(30) NOT NULL,
  "eventId" UUID NOT NULL,
  "payloadHash" CHAR(64) NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderCallback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TariffVersion_version_key" ON "TariffVersion"("version");
CREATE INDEX "TariffVersion_status_version_idx" ON "TariffVersion"("status", "version");
CREATE UNIQUE INDEX "Order_layoutApprovalId_key" ON "Order"("layoutApprovalId");
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");
CREATE INDEX "Order_status_updatedAt_idx" ON "Order"("status", "updatedAt");
CREATE UNIQUE INDEX "PriceSnapshot_orderId_key" ON "PriceSnapshot"("orderId");
CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");
CREATE UNIQUE INDEX "Payment_providerPaymentReference_key" ON "Payment"("providerPaymentReference");
CREATE INDEX "Payment_status_updatedAt_idx" ON "Payment"("status", "updatedAt");
CREATE UNIQUE INDEX "RefundOperation_paymentId_key" ON "RefundOperation"("paymentId");
CREATE UNIQUE INDEX "RefundOperation_triggerDedupKey_key" ON "RefundOperation"("triggerDedupKey");
CREATE UNIQUE INDEX "RefundOperation_providerRefundReference_key" ON "RefundOperation"("providerRefundReference");
CREATE UNIQUE INDEX "IdempotencyRecord_scope_keyDigest_key" ON "IdempotencyRecord"("scope", "keyDigest");
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");
CREATE UNIQUE INDEX "ProviderCallback_provider_eventId_key" ON "ProviderCallback"("provider", "eventId");

ALTER TABLE "TariffVersion" ADD CONSTRAINT "TariffVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "LayoutRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_layoutApprovalId_fkey" FOREIGN KEY ("layoutApprovalId") REFERENCES "LayoutApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_printReadyVersionId_fkey" FOREIGN KEY ("printReadyVersionId") REFERENCES "PrintReadyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_tariffVersionId_fkey" FOREIGN KEY ("tariffVersionId") REFERENCES "TariffVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundOperation" ADD CONSTRAINT "RefundOperation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
