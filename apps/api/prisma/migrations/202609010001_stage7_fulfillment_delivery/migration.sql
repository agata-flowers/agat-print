ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PICKUP';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'COURIER_ASSIGNED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'IN_DELIVERY';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DELIVERY_FAILED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

CREATE TYPE "CourierStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED');
CREATE TYPE "FulfillmentMode" AS ENUM ('PICKUP', 'DELIVERY');
CREATE TYPE "FulfillmentStatus" AS ENUM ('AWAITING_HANDOFF', 'IN_DELIVERY', 'COMPLETED', 'FAILED');
CREATE TYPE "DeliveryStatus" AS ENUM ('ASSIGNED', 'IN_DELIVERY', 'DELIVERED', 'FAILED');
CREATE TYPE "PrinterAgentStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING', 'LEASED', 'PRINTING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "CourierProfile" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "displayName" VARCHAR(160) NOT NULL,
  "serviceZone" VARCHAR(40) NOT NULL,
  "status" "CourierStatus" NOT NULL DEFAULT 'PENDING',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourierProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderFulfillment" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "mode" "FulfillmentMode" NOT NULL,
  "status" "FulfillmentStatus" NOT NULL DEFAULT 'AWAITING_HANDOFF',
  "requestKeyDigest" CHAR(64) NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "completionNonce" CHAR(32) NOT NULL,
  "completionPinDigest" CHAR(64) NOT NULL,
  "completionAttempts" INTEGER NOT NULL DEFAULT 0,
  "completionExpiresAt" TIMESTAMP(3) NOT NULL,
  "completionUsedAt" TIMESTAMP(3),
  "handoffNonce" CHAR(32),
  "handoffPinDigest" CHAR(64),
  "handoffAttempts" INTEGER NOT NULL DEFAULT 0,
  "handoffUsedAt" TIMESTAMP(3),
  "addressCiphertext" TEXT,
  "addressIv" VARCHAR(24),
  "addressAuthTag" VARCHAR(32),
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderFulfillment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryTask" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "fulfillmentId" UUID NOT NULL,
  "courierId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "providerReference" VARCHAR(160) NOT NULL,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'ASSIGNED',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 0,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "pickedUpAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "failureCode" VARCHAR(40),
  CONSTRAINT "DeliveryTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrinterAgent" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "label" VARCHAR(80) NOT NULL,
  "tokenDigest" CHAR(64) NOT NULL,
  "status" "PrinterAgentStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "PrinterAgent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrintJob" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "assignmentId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "agentId" UUID,
  "status" "PrintJobStatus" NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseUntil" TIMESTAMP(3),
  "failureCode" VARCHAR(40),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourierProfile_userId_key" ON "CourierProfile"("userId");
CREATE INDEX "CourierProfile_status_active_serviceZone_idx" ON "CourierProfile"("status", "active", "serviceZone");
CREATE UNIQUE INDEX "OrderFulfillment_orderId_key" ON "OrderFulfillment"("orderId");
CREATE UNIQUE INDEX "OrderFulfillment_orderId_requestKeyDigest_key" ON "OrderFulfillment"("orderId", "requestKeyDigest");
CREATE INDEX "OrderFulfillment_status_completionExpiresAt_idx" ON "OrderFulfillment"("status", "completionExpiresAt");
CREATE UNIQUE INDEX "DeliveryTask_orderId_key" ON "DeliveryTask"("orderId");
CREATE UNIQUE INDEX "DeliveryTask_fulfillmentId_key" ON "DeliveryTask"("fulfillmentId");
CREATE UNIQUE INDEX "DeliveryTask_providerReference_key" ON "DeliveryTask"("providerReference");
CREATE INDEX "DeliveryTask_courierId_active_assignedAt_idx" ON "DeliveryTask"("courierId", "active", "assignedAt");
CREATE INDEX "DeliveryTask_status_assignedAt_idx" ON "DeliveryTask"("status", "assignedAt");
CREATE UNIQUE INDEX "DeliveryTask_one_active_per_order" ON "DeliveryTask"("orderId") WHERE "active" = true;
CREATE UNIQUE INDEX "DeliveryTask_one_active_per_courier" ON "DeliveryTask"("courierId") WHERE "active" = true;
CREATE UNIQUE INDEX "PrinterAgent_tokenDigest_key" ON "PrinterAgent"("tokenDigest");
CREATE INDEX "PrinterAgent_branchId_status_idx" ON "PrinterAgent"("branchId", "status");
CREATE UNIQUE INDEX "PrintJob_orderId_key" ON "PrintJob"("orderId");
CREATE UNIQUE INDEX "PrintJob_assignmentId_key" ON "PrintJob"("assignmentId");
CREATE INDEX "PrintJob_branchId_status_createdAt_idx" ON "PrintJob"("branchId", "status", "createdAt");
CREATE INDEX "PrintJob_agentId_status_idx" ON "PrintJob"("agentId", "status");

ALTER TABLE "CourierProfile" ADD CONSTRAINT "CourierProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderFulfillment" ADD CONSTRAINT "OrderFulfillment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryTask" ADD CONSTRAINT "DeliveryTask_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryTask" ADD CONSTRAINT "DeliveryTask_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "OrderFulfillment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryTask" ADD CONSTRAINT "DeliveryTask_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryTask" ADD CONSTRAINT "DeliveryTask_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrinterAgent" ADD CONSTRAINT "PrinterAgent_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrinterAgent" ADD CONSTRAINT "PrinterAgent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "PartnerAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "PrinterAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
