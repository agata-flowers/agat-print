import { createHash, randomUUID } from "node:crypto";
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { ObjectRetentionClass, Prisma } from "@prisma/client";
import type { AppEnvironment } from "../config/environment";
import { PrismaService } from "../prisma/prisma.service";
import { AntivirusService } from "./antivirus.service";
import {
  APP_ENVIRONMENT,
  PrivateObjectStorageService,
} from "./private-object-storage.service";
import { validateUpload } from "./upload-policy";

@Injectable()
export class ProcessingResultService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PrivateObjectStorageService)
    private readonly storage: PrivateObjectStorageService,
    @Inject(AntivirusService) private readonly antivirus: AntivirusService,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {}

  async claim(jobId: string, dedupKey: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const completed = await tx.inboxOperation.findUnique({
          where: { dedupKey },
        });
        if (completed) return { duplicate: true as const };
        const job = await tx.processingJob.findUnique({ where: { id: jobId } });
        if (
          !job ||
          job.dedupKey !== dedupKey ||
          !(
            job.status === "PENDING" ||
            (job.status === "RUNNING" &&
              job.leaseUntil !== null &&
              job.leaseUntil < new Date())
          )
        )
          return { duplicate: true as const };
        const leaseOwner = randomUUID();
        const claimed = await tx.processingJob.updateMany({
          where: {
            id: jobId,
            dedupKey,
            OR: [
              { status: "PENDING" },
              { status: "RUNNING", leaseUntil: { lt: new Date() } },
            ],
          },
          data: {
            status: "RUNNING",
            leaseOwner,
            leaseUntil: new Date(Date.now() + 5 * 60_000),
            attempts: { increment: 1 },
          },
        });
        if (claimed.count !== 1) return { duplicate: true as const };
        const processing = await tx.uploadSession.updateMany({
          where: {
            id: job.uploadId,
            status: "QUEUED",
            version: job.aggregateVersion,
          },
          data: { status: "PROCESSING", version: { increment: 1 } },
        });
        if (processing.count === 1) {
          await tx.processingJob.update({
            where: { id: jobId },
            data: { aggregateVersion: { increment: 1 } },
          });
        }
        return { duplicate: false as const, leaseOwner };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async complete(
    jobId: string,
    dedupKey: string,
    leaseOwner: string,
    output: Buffer,
  ) {
    const existingInbox = await this.prisma.inboxOperation.findUnique({
      where: { dedupKey },
    });
    if (existingInbox?.resultId)
      return this.prisma.processingResult.findUniqueOrThrow({
        where: { id: existingInbox.resultId },
        select: { id: true, pageCount: true },
      });

    const validation = await validateUpload(
      "PDF",
      "application/pdf",
      output,
      this.env,
    );
    await this.antivirus.scan(output);
    const jobRecord = await this.prisma.processingJob.findUniqueOrThrow({
      where: { id: jobId },
      select: { resultObjectKey: true, dedupKey: true },
    });
    if (jobRecord.dedupKey !== dedupKey) throw new ConflictException();
    const objectKey = jobRecord.resultObjectKey;
    await this.storage.putPermanent(objectKey, output);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const job = await tx.processingJob.findUniqueOrThrow({
            where: { id: jobId },
          });
          if (
            job.dedupKey !== dedupKey ||
            job.status !== "RUNNING" ||
            job.leaseOwner !== leaseOwner ||
            !job.leaseUntil ||
            job.leaseUntil <= new Date()
          )
            throw new ConflictException();
          const result = await tx.processingResult.create({
            data: {
              jobId,
              uploadId: job.uploadId,
              objectKey,
              checksum: validation.checksum,
              sizeBytes: BigInt(output.length),
              pageCount: validation.pageCount,
            },
            select: { id: true, pageCount: true },
          });
          await tx.inboxOperation.create({
            data: {
              dedupKey,
              operation: job.operation,
              resultId: result.id,
            },
          });
          await tx.processingJob.update({
            where: { id: jobId },
            data: {
              status: "SUCCEEDED",
              leaseOwner: null,
              leaseUntil: null,
            },
          });
          const upload = await tx.uploadSession.updateMany({
            where: {
              id: job.uploadId,
              status: { in: ["QUEUED", "PROCESSING"] },
              version: job.aggregateVersion,
            },
            data: {
              status: "READY",
              completedAt: new Date(),
              version: { increment: 1 },
            },
          });
          if (upload.count !== 1) throw new ConflictException();
          await tx.permanentObjectReference.create({
            data: {
              objectKey,
              checksum: createHash("sha256").update(output).digest("hex"),
              retentionClass: ObjectRetentionClass.DERIVATIVE,
              expiresAt: new Date(Date.now() + 30 * 86_400_000),
            },
          });
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const existing = await this.prisma.inboxOperation.findUnique({
        where: { dedupKey },
      });
      if (existing?.resultId)
        return this.prisma.processingResult.findUniqueOrThrow({
          where: { id: existing.resultId },
          select: { id: true, pageCount: true },
        });
      await this.storage.remove(objectKey).catch(() => undefined);
      throw error;
    }
  }

  async fail(
    jobId: string,
    leaseOwner: string,
    finalAttempt: boolean,
  ): Promise<void> {
    const job = await this.prisma.processingJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.status !== "RUNNING" || job.leaseOwner !== leaseOwner)
      return;
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.processingJob.updateMany({
        where: { id: jobId, status: "RUNNING", leaseOwner },
        data: {
          status: finalAttempt ? "DEAD_LETTER" : "PENDING",
          leaseOwner: null,
          leaseUntil: null,
          lastErrorCode: finalAttempt
            ? "PROCESSING_RETRY_EXHAUSTED"
            : "PROCESSING_FAILED",
        },
      });
      if (updated.count !== 1 || !finalAttempt) return;
      await tx.uploadSession.updateMany({
        where: {
          id: job.uploadId,
          status: { in: ["QUEUED", "PROCESSING"] },
          version: job.aggregateVersion,
        },
        data: { status: "FAILED", version: { increment: 1 } },
      });
    });
  }
}
