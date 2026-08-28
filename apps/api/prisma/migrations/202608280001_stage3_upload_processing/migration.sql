CREATE TYPE "UploadFileKind" AS ENUM ('PDF', 'DOCX', 'JPEG', 'PNG');
CREATE TYPE "UploadStatus" AS ENUM (
  'CREATED', 'QUARANTINED', 'SCANNING', 'QUEUED', 'PROCESSING',
  'READY', 'REJECTED', 'CANCELLED', 'EXPIRED', 'FAILED'
);
CREATE TYPE "ProcessingOperation" AS ENUM ('NORMALIZE');
CREATE TYPE "ProcessingJobStatus" AS ENUM (
  'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER'
);

CREATE TABLE "UploadSession" (
  "id" UUID NOT NULL,
  "fileVersion" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "fileKind" "UploadFileKind" NOT NULL,
  "declaredMime" VARCHAR(100) NOT NULL,
  "expectedSizeBytes" BIGINT NOT NULL,
  "actualSizeBytes" BIGINT,
  "sha256" CHAR(64),
  "pageCount" INTEGER,
  "pixelCount" BIGINT,
  "status" "UploadStatus" NOT NULL DEFAULT 'CREATED',
  "quarantineObjectKey" VARCHAR(160) NOT NULL,
  "permanentObjectKey" VARCHAR(160),
  "version" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "rejectionCode" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UploadSession_expectedSizeBytes_check" CHECK ("expectedSizeBytes" > 0),
  CONSTRAINT "UploadSession_actualSizeBytes_check" CHECK ("actualSizeBytes" IS NULL OR "actualSizeBytes" > 0)
);

CREATE TABLE "ProcessingJob" (
  "id" UUID NOT NULL,
  "uploadId" UUID NOT NULL,
  "operation" "ProcessingOperation" NOT NULL,
  "settingsHash" CHAR(64) NOT NULL,
  "dedupKey" CHAR(64) NOT NULL,
  "resultObjectKey" VARCHAR(160) NOT NULL,
  "status" "ProcessingJobStatus" NOT NULL DEFAULT 'PENDING',
  "aggregateVersion" INTEGER NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseOwner" VARCHAR(100),
  "leaseUntil" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcessingResult" (
  "id" UUID NOT NULL,
  "jobId" UUID NOT NULL,
  "uploadId" UUID NOT NULL,
  "objectKey" VARCHAR(160) NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "pageCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcessingResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProcessingResult_sizeBytes_check" CHECK ("sizeBytes" > 0),
  CONSTRAINT "ProcessingResult_pageCount_check" CHECK ("pageCount" > 0)
);

CREATE TABLE "OutboxEvent" (
  "id" UUID NOT NULL,
  "aggregateType" VARCHAR(50) NOT NULL,
  "aggregateId" UUID NOT NULL,
  "aggregateVersion" INTEGER NOT NULL,
  "eventType" VARCHAR(80) NOT NULL,
  "dedupKey" CHAR(64) NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InboxOperation" (
  "dedupKey" CHAR(64) NOT NULL,
  "operation" VARCHAR(80) NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resultId" UUID,
  CONSTRAINT "InboxOperation_pkey" PRIMARY KEY ("dedupKey")
);

CREATE UNIQUE INDEX "UploadSession_fileVersion_key" ON "UploadSession"("fileVersion");
CREATE UNIQUE INDEX "UploadSession_quarantineObjectKey_key" ON "UploadSession"("quarantineObjectKey");
CREATE UNIQUE INDEX "UploadSession_permanentObjectKey_key" ON "UploadSession"("permanentObjectKey");
CREATE INDEX "UploadSession_userId_status_idx" ON "UploadSession"("userId", "status");
CREATE INDEX "UploadSession_status_expiresAt_idx" ON "UploadSession"("status", "expiresAt");
CREATE UNIQUE INDEX "ProcessingJob_dedupKey_key" ON "ProcessingJob"("dedupKey");
CREATE UNIQUE INDEX "ProcessingJob_resultObjectKey_key" ON "ProcessingJob"("resultObjectKey");
CREATE INDEX "ProcessingJob_status_leaseUntil_idx" ON "ProcessingJob"("status", "leaseUntil");
CREATE UNIQUE INDEX "ProcessingResult_jobId_key" ON "ProcessingResult"("jobId");
CREATE UNIQUE INDEX "ProcessingResult_objectKey_key" ON "ProcessingResult"("objectKey");
CREATE UNIQUE INDEX "OutboxEvent_dedupKey_key" ON "OutboxEvent"("dedupKey");
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");

ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_uploadId_fkey"
  FOREIGN KEY ("uploadId") REFERENCES "UploadSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcessingResult" ADD CONSTRAINT "ProcessingResult_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "ProcessingJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcessingResult" ADD CONSTRAINT "ProcessingResult_uploadId_fkey"
  FOREIGN KEY ("uploadId") REFERENCES "UploadSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
