import { createHash, randomBytes } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ObjectRetentionClass,
  Prisma,
  ProcessingOperation,
  type UploadFileKind,
  UploadStatus,
} from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import type { AppEnvironment } from "../config/environment";
import { PrismaService } from "../prisma/prisma.service";
import { AntivirusService } from "./antivirus.service";
import type { CreateUploadSessionDto } from "./dto";
import {
  APP_ENVIRONMENT,
  PrivateObjectStorageService,
} from "./private-object-storage.service";
import {
  processingDedupKey,
  UploadPolicyError,
  validateUpload,
} from "./upload-policy";

const ACTIVE_STATUSES: UploadStatus[] = [
  "CREATED",
  "QUARANTINED",
  "SCANNING",
  "QUEUED",
  "PROCESSING",
  "READY",
];

const KIND_BY_EXTENSION: Record<
  CreateUploadSessionDto["extension"],
  UploadFileKind
> = {
  pdf: "PDF",
  docx: "DOCX",
  jpg: "JPEG",
  jpeg: "JPEG",
  png: "PNG",
};

const opaqueKey = (zone: "quarantine" | "objects" | "results"): string =>
  `${zone}/${randomBytes(32).toString("hex")}`;

@Injectable()
export class UploadService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PrivateObjectStorageService)
    private readonly storage: PrivateObjectStorageService,
    @Inject(AntivirusService) private readonly antivirus: AntivirusService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {}

  async create(userId: string, dto: CreateUploadSessionDto) {
    if (dto.sizeBytes > this.env.uploadMaxFileBytes)
      throw new PayloadTooLargeException({ code: "FILE_SIZE_EXCEEDED" });
    const session = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
        const usage = await tx.uploadSession.aggregate({
          where: { userId, status: { in: ACTIVE_STATUSES } },
          _sum: { expectedSizeBytes: true },
        });
        const reserved = usage._sum.expectedSizeBytes ?? 0n;
        if (
          reserved + BigInt(dto.sizeBytes) >
          BigInt(this.env.uploadUserActiveQuotaBytes)
        )
          throw new PayloadTooLargeException({ code: "USER_QUOTA_EXCEEDED" });
        return tx.uploadSession.create({
          data: {
            userId,
            fileKind: KIND_BY_EXTENSION[dto.extension],
            declaredMime: dto.declaredMime,
            expectedSizeBytes: BigInt(dto.sizeBytes),
            quarantineObjectKey: opaqueKey("quarantine"),
            expiresAt: new Date(
              Date.now() + this.env.uploadSessionTtlSeconds * 1000,
            ),
          },
          select: { id: true, status: true, expiresAt: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.audit.record("UPLOAD_SESSION_CREATED", userId, "upload", {
      status: session.status,
    });
    return session;
  }

  async putContent(userId: string, id: string, value: Buffer) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id },
    });
    if (!session) throw new NotFoundException();
    if (session.userId !== userId) throw new ForbiddenException();
    if (session.status !== "CREATED") throw new ConflictException();
    if (
      value.length !== Number(session.expectedSizeBytes) ||
      value.length > this.env.uploadMaxFileBytes
    )
      throw new PayloadTooLargeException({ code: "SIZE_MISMATCH" });

    try {
      await this.storage.putQuarantine(session.quarantineObjectKey, value);
    } catch {
      throw new ServiceUnavailableException({
        code: "OBJECT_STORAGE_UNAVAILABLE",
      });
    }
    const claimed = await this.prisma.uploadSession.updateMany({
      where: { id, userId, status: "CREATED", version: session.version },
      data: { status: "QUARANTINED", version: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      await this.storage.remove(session.quarantineObjectKey);
      throw new ConflictException();
    }

    let permanentKey: string | undefined;
    try {
      const validation = await validateUpload(
        session.fileKind,
        session.declaredMime,
        value,
        this.env,
      );
      await this.prisma.uploadSession.update({
        where: { id },
        data: { status: "SCANNING", version: { increment: 1 } },
      });
      await this.antivirus.scan(value);
      permanentKey = opaqueKey("objects");
      await this.storage.promote(session.quarantineObjectKey, permanentKey);

      const settingsHash = createHash("sha256")
        .update(
          JSON.stringify({
            operation: "NORMALIZE",
            maxPages: this.env.uploadMaxPages,
            maxPixels: this.env.uploadMaxImagePixels,
            maxOutputBytes: this.env.uploadMaxFileBytes,
            processingImage: this.env.processingImage,
          }),
        )
        .digest("hex");
      const dedupKey = processingDedupKey(
        session.fileVersion,
        ProcessingOperation.NORMALIZE,
        settingsHash,
      );
      const updated = await this.prisma.$transaction(async (tx) => {
        const cas = await tx.uploadSession.updateMany({
          where: {
            id,
            userId,
            status: "SCANNING",
            version: session.version + 2,
          },
          data: {
            status: "QUEUED",
            permanentObjectKey: permanentKey,
            actualSizeBytes: BigInt(value.length),
            sha256: validation.checksum,
            pageCount: validation.pageCount,
            pixelCount: validation.pixelCount,
            version: { increment: 1 },
          },
        });
        if (cas.count !== 1) throw new ConflictException();
        const job = await tx.processingJob.create({
          data: {
            uploadId: id,
            operation: "NORMALIZE",
            settingsHash,
            dedupKey,
            resultObjectKey: opaqueKey("results"),
            aggregateVersion: session.version + 3,
          },
        });
        await tx.permanentObjectReference.create({
          data: {
            objectKey: permanentKey as string,
            checksum: validation.checksum,
            retentionClass: ObjectRetentionClass.ORIGINAL,
            expiresAt: new Date(Date.now() + 7 * 86_400_000),
          },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "UploadSession",
            aggregateId: id,
            aggregateVersion: session.version + 3,
            eventType: "FILE_PROCESSING_REQUESTED",
            dedupKey,
            payload: {
              jobId: job.id,
              operation: "NORMALIZE",
              dedupKey,
            },
          },
        });
        return tx.uploadSession.findUniqueOrThrow({
          where: { id },
          select: { id: true, status: true, pageCount: true },
        });
      });
      await this.storage.remove(session.quarantineObjectKey);
      await this.audit.record("UPLOAD_ACCEPTED", userId, "upload", {
        status: updated.status,
        operation: "NORMALIZE",
      });
      return updated;
    } catch (error) {
      if (permanentKey)
        await this.storage.remove(permanentKey).catch(() => undefined);
      await this.storage
        .remove(session.quarantineObjectKey)
        .catch(() => undefined);
      const code =
        error instanceof UploadPolicyError
          ? error.safeCode
          : error instanceof ServiceUnavailableException
            ? "ANTIVIRUS_UNAVAILABLE"
            : "UPLOAD_FAILED";
      await this.prisma.uploadSession.updateMany({
        where: {
          id,
          status: { in: ["QUARANTINED", "SCANNING"] },
        },
        data: {
          status:
            error instanceof ServiceUnavailableException
              ? "FAILED"
              : "REJECTED",
          rejectionCode: code,
          version: { increment: 1 },
        },
      });
      if (
        error instanceof UploadPolicyError ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException({
        code: "UPLOAD_DEPENDENCY_FAILED",
      });
    }
  }

  async cancel(userId: string, id: string): Promise<void> {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id },
    });
    if (!session) throw new NotFoundException();
    if (session.userId !== userId) throw new ForbiddenException();
    const updated = await this.prisma.uploadSession.updateMany({
      where: {
        id,
        userId,
        status: { in: ["CREATED", "QUARANTINED", "SCANNING", "QUEUED"] },
        version: session.version,
      },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new ConflictException();
    await Promise.all([
      this.storage.remove(session.quarantineObjectKey).catch(() => undefined),
      session.permanentObjectKey
        ? this.storage.remove(session.permanentObjectKey).catch(() => undefined)
        : Promise.resolve(),
    ]);
    if (session.permanentObjectKey) {
      await this.prisma.$transaction([
        this.prisma.permanentObjectReference.updateMany({
          where: { objectKey: session.permanentObjectKey, deletedAt: null },
          data: { deletedAt: new Date() },
        }),
        this.prisma.retentionTombstone.upsert({
          where: { objectKey: session.permanentObjectKey },
          create: {
            objectKey: session.permanentObjectKey,
            reason: "UPLOAD_CANCELLED",
          },
          update: {},
        }),
      ]);
    }
    await this.audit.record("UPLOAD_CANCELLED", userId, "upload", {
      status: "CANCELLED",
    });
  }

  async cleanupExpired(): Promise<number> {
    const sessions = await this.prisma.uploadSession.findMany({
      where: {
        status: { in: ["CREATED", "QUARANTINED", "SCANNING"] },
        expiresAt: { lte: new Date() },
      },
      take: 100,
    });
    let cleaned = 0;
    for (const session of sessions) {
      const updated = await this.prisma.uploadSession.updateMany({
        where: { id: session.id, version: session.version },
        data: { status: "EXPIRED", version: { increment: 1 } },
      });
      if (updated.count !== 1) continue;
      await this.storage
        .remove(session.quarantineObjectKey)
        .catch(() => undefined);
      cleaned += 1;
    }
    return cleaned;
  }
}
