CREATE TYPE "LayoutStatus" AS ENUM (
  'PROCESSING',
  'QUALITY_CHECK_FAILED',
  'MANUAL_REVIEW_REQUIRED',
  'AWAITING_APPROVAL',
  'APPROVED'
);

CREATE TYPE "ManualReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');
ALTER TYPE "ProcessingOperation" ADD VALUE IF NOT EXISTS 'PREFLIGHT';

CREATE TABLE "LayoutRequest" (
  "id" UUID NOT NULL,
  "uploadId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "sourceFileVersion" UUID NOT NULL,
  "settingsHash" CHAR(64) NOT NULL,
  "settings" JSONB NOT NULL,
  "status" "LayoutStatus" NOT NULL DEFAULT 'PROCESSING',
  "version" INTEGER NOT NULL DEFAULT 0,
  "latestPreviewId" UUID,
  "latestPrintReadyId" UUID,
  "currentApprovalId" UUID,
  "qualityCode" VARCHAR(80),
  "manualReviewReason" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LayoutRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PreviewVersion" (
  "id" UUID NOT NULL,
  "layoutId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "objectKey" VARCHAR(160) NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "sourceFileVersion" UUID NOT NULL,
  "settingsHash" CHAR(64) NOT NULL,
  "originProcessingResultId" UUID NOT NULL,
  "pageCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PreviewVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrintReadyVersion" (
  "id" UUID NOT NULL,
  "layoutId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "objectKey" VARCHAR(160) NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "sourceFileVersion" UUID NOT NULL,
  "settingsHash" CHAR(64) NOT NULL,
  "originProcessingResultId" UUID NOT NULL,
  "pageCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrintReadyVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LayoutApproval" (
  "id" UUID NOT NULL,
  "layoutId" UUID NOT NULL,
  "previewVersionId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "layoutVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LayoutApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManualReview" (
  "id" UUID NOT NULL,
  "layoutId" UUID NOT NULL,
  "previewVersionId" UUID NOT NULL,
  "status" "ManualReviewStatus" NOT NULL DEFAULT 'PENDING',
  "reason" VARCHAR(80) NOT NULL,
  "reviewerId" UUID,
  "decisionAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManualReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LayoutRequest_uploadId_key" ON "LayoutRequest"("uploadId");
CREATE INDEX "LayoutRequest_userId_status_idx" ON "LayoutRequest"("userId", "status");
CREATE INDEX "LayoutRequest_status_updatedAt_idx" ON "LayoutRequest"("status", "updatedAt");
CREATE UNIQUE INDEX "PreviewVersion_objectKey_key" ON "PreviewVersion"("objectKey");
CREATE UNIQUE INDEX "PreviewVersion_layoutId_version_key" ON "PreviewVersion"("layoutId", "version");
CREATE UNIQUE INDEX "PreviewVersion_layoutId_sourceFileVersion_settingsHash_key" ON "PreviewVersion"("layoutId", "sourceFileVersion", "settingsHash");
CREATE UNIQUE INDEX "PrintReadyVersion_objectKey_key" ON "PrintReadyVersion"("objectKey");
CREATE UNIQUE INDEX "PrintReadyVersion_layoutId_version_key" ON "PrintReadyVersion"("layoutId", "version");
CREATE UNIQUE INDEX "PrintReadyVersion_layoutId_sourceFileVersion_settingsHash_key" ON "PrintReadyVersion"("layoutId", "sourceFileVersion", "settingsHash");
CREATE UNIQUE INDEX "LayoutApproval_layoutId_previewVersionId_key" ON "LayoutApproval"("layoutId", "previewVersionId");
CREATE INDEX "LayoutApproval_userId_createdAt_idx" ON "LayoutApproval"("userId", "createdAt");
CREATE UNIQUE INDEX "ManualReview_previewVersionId_key" ON "ManualReview"("previewVersionId");
CREATE INDEX "ManualReview_status_createdAt_idx" ON "ManualReview"("status", "createdAt");

ALTER TABLE "LayoutRequest" ADD CONSTRAINT "LayoutRequest_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "UploadSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LayoutRequest" ADD CONSTRAINT "LayoutRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PreviewVersion" ADD CONSTRAINT "PreviewVersion_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "LayoutRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PreviewVersion" ADD CONSTRAINT "PreviewVersion_originProcessingResultId_fkey" FOREIGN KEY ("originProcessingResultId") REFERENCES "ProcessingResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrintReadyVersion" ADD CONSTRAINT "PrintReadyVersion_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "LayoutRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrintReadyVersion" ADD CONSTRAINT "PrintReadyVersion_originProcessingResultId_fkey" FOREIGN KEY ("originProcessingResultId") REFERENCES "ProcessingResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LayoutApproval" ADD CONSTRAINT "LayoutApproval_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "LayoutRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LayoutApproval" ADD CONSTRAINT "LayoutApproval_previewVersionId_fkey" FOREIGN KEY ("previewVersionId") REFERENCES "PreviewVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LayoutApproval" ADD CONSTRAINT "LayoutApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManualReview" ADD CONSTRAINT "ManualReview_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "LayoutRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManualReview" ADD CONSTRAINT "ManualReview_previewVersionId_fkey" FOREIGN KEY ("previewVersionId") REFERENCES "PreviewVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManualReview" ADD CONSTRAINT "ManualReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
