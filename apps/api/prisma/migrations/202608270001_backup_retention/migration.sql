CREATE TYPE "ObjectRetentionClass" AS ENUM ('ORIGINAL', 'PREVIEW', 'DERIVATIVE', 'PRINT_READY');

CREATE TABLE "PermanentObjectReference" (
  "objectKey" VARCHAR(1024) PRIMARY KEY,
  "checksum" CHAR(64) NOT NULL,
  "retentionClass" "ObjectRetentionClass" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PermanentObjectReference_objectKey_check"
    CHECK ("objectKey" <> '' AND "objectKey" !~ '(^/|(^|/)\.\.(/|$)|[[:cntrl:]])'),
  CONSTRAINT "PermanentObjectReference_checksum_check"
    CHECK ("checksum" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "PermanentObjectReference_expiresAt_deletedAt_idx"
  ON "PermanentObjectReference"("expiresAt", "deletedAt");

CREATE TABLE "RetentionTombstone" (
  "objectKey" VARCHAR(1024) PRIMARY KEY,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason" VARCHAR(80)
);

CREATE INDEX "RetentionTombstone_deletedAt_idx"
  ON "RetentionTombstone"("deletedAt");
