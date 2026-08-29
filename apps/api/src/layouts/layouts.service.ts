import { createHash, randomBytes } from "node:crypto";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ObjectRetentionClass, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import type { AppEnvironment } from "../config/environment";
import { PrismaService } from "../prisma/prisma.service";
import { AntivirusService } from "../uploads/antivirus.service";
import { CommandIsolatedProcessorService } from "../uploads/command-isolated-processor.service";
import {
  APP_ENVIRONMENT,
  PrivateObjectStorageService,
} from "../uploads/private-object-storage.service";
import { validateUpload } from "../uploads/upload-policy";
import type {
  ConfirmLayoutDto,
  GenerateLayoutDto,
  ManualReviewDecisionDto,
} from "./dto";

const opaqueKey = (zone: "previews" | "print-ready"): string =>
  `${zone}/${randomBytes(32).toString("hex")}`;

const hashSettings = (sourceFileVersion: string, input: GenerateLayoutDto) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        sourceFileVersion,
        targetWidthMm: input.targetWidthMm,
        targetHeightMm: input.targetHeightMm,
        minDpi: input.minDpi,
        photoDocument: input.photoDocument,
      }),
    )
    .digest("hex");

const view = (layout: {
  id: string;
  uploadId: string;
  status: string;
  version: number;
  latestPreviewId: string | null;
  latestPrintReadyId: string | null;
  qualityCode: string | null;
  manualReviewReason: string | null;
  currentApprovalId: string | null;
}) => ({
  id: layout.id,
  uploadId: layout.uploadId,
  status: layout.status,
  version: layout.version,
  latestPreviewId: layout.latestPreviewId,
  latestPrintReadyId: layout.latestPrintReadyId,
  qualityCode: layout.qualityCode,
  manualReviewReason: layout.manualReviewReason,
  approved: layout.currentApprovalId !== null,
});

@Injectable()
export class LayoutsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PrivateObjectStorageService)
    private readonly storage: PrivateObjectStorageService,
    @Inject(CommandIsolatedProcessorService)
    private readonly processor: CommandIsolatedProcessorService,
    @Inject(AntivirusService) private readonly antivirus: AntivirusService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {}

  async generate(userId: string, input: GenerateLayoutDto) {
    const upload = await this.prisma.uploadSession.findFirst({
      where: { id: input.uploadId, userId, status: "READY" },
      include: {
        processingResults: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!upload?.permanentObjectKey || !upload.processingResults[0])
      throw new ConflictException({ code: "STAGE3_FILE_NOT_READY" });
    const origin = upload.processingResults[0];
    const settingsHash = hashSettings(upload.fileVersion, input);
    const existing = input.layoutId
      ? await this.prisma.layoutRequest.findFirst({
          where: { id: input.layoutId, userId },
        })
      : await this.prisma.layoutRequest.findUnique({
          where: { uploadId: upload.id },
        });
    if (input.layoutId && !existing) throw new NotFoundException();
    if (
      existing?.sourceFileVersion === upload.fileVersion &&
      existing.settingsHash === settingsHash &&
      existing.status !== "PROCESSING"
    )
      return view(existing);

    const settings = {
      targetWidthMm: input.targetWidthMm,
      targetHeightMm: input.targetHeightMm,
      minDpi: input.minDpi,
      photoDocument: input.photoDocument,
    };
    const layout = existing
      ? await this.prisma.$transaction(async (tx) => {
          await tx.manualReview.updateMany({
            where: { layoutId: existing.id, status: "PENDING" },
            data: { status: "SUPERSEDED", version: { increment: 1 } },
          });
          return tx.layoutRequest.update({
            where: { id: existing.id },
            data: {
              uploadId: upload.id,
              sourceFileVersion: upload.fileVersion,
              settingsHash,
              settings,
              status: "PROCESSING",
              qualityCode: null,
              manualReviewReason: null,
              currentApprovalId: null,
              version: { increment: 1 },
            },
          });
        })
      : await this.prisma.layoutRequest.create({
          data: {
            uploadId: upload.id,
            userId,
            sourceFileVersion: upload.fileVersion,
            settingsHash,
            settings,
          },
        });

    let processed: Awaited<
      ReturnType<CommandIsolatedProcessorService["preflight"]>
    >;
    try {
      const source = await this.storage.get(
        upload.permanentObjectKey,
        this.env.uploadMaxFileBytes,
      );
      processed = await this.processor.preflight(upload.fileKind, source, {
        targetWidthMm: input.targetWidthMm,
        targetHeightMm: input.targetHeightMm,
        photoDocument: input.photoDocument,
      });
      await validateUpload(
        "PDF",
        "application/pdf",
        processed.output,
        this.env,
      );
      await this.antivirus.scan(processed.output);
    } catch {
      const failed = await this.markQualityFailure(
        layout.id,
        "PREFLIGHT_FAILED",
      );
      await this.audit.record("LAYOUT_QUALITY_FAILED", userId, "layout", {
        status: "QUALITY_CHECK_FAILED",
      });
      return view(failed);
    }

    if (
      processed.metadata.printSuitable === false ||
      (processed.metadata.effectiveDpi !== undefined &&
        processed.metadata.effectiveDpi < input.minDpi)
    ) {
      const failed = await this.markQualityFailure(
        layout.id,
        "IMAGE_RESOLUTION_TOO_LOW",
      );
      await this.audit.record("LAYOUT_QUALITY_FAILED", userId, "layout", {
        status: "QUALITY_CHECK_FAILED",
      });
      return view(failed);
    }

    const requiresManualReview =
      input.photoDocument &&
      [
        processed.metadata.backgroundConfidence,
        processed.metadata.headPositionConfidence,
        processed.metadata.photoSizeConfidence,
      ].some((confidence) => confidence === undefined || confidence < 0.9);
    const previewKey = opaqueKey("previews");
    const printReadyKey = opaqueKey("print-ready");
    const checksum = createHash("sha256")
      .update(processed.output)
      .digest("hex");
    try {
      await this.storage.putDocument(previewKey, processed.output);
      await this.storage.putDocument(printReadyKey, processed.output);
      const result = await this.prisma.$transaction(
        async (tx) => {
          const current = await tx.layoutRequest.findUniqueOrThrow({
            where: { id: layout.id },
          });
          if (
            current.settingsHash !== settingsHash ||
            current.sourceFileVersion !== upload.fileVersion ||
            current.status !== "PROCESSING"
          )
            throw new ConflictException({ code: "LAYOUT_REVISION_CHANGED" });
          const duplicate = await tx.previewVersion.findUnique({
            where: {
              layoutId_sourceFileVersion_settingsHash: {
                layoutId: layout.id,
                sourceFileVersion: upload.fileVersion,
                settingsHash,
              },
            },
          });
          if (duplicate)
            return {
              created: false,
              layout: await tx.layoutRequest.findUniqueOrThrow({
                where: { id: layout.id },
              }),
            };
          const aggregate = await tx.previewVersion.aggregate({
            where: { layoutId: layout.id },
            _max: { version: true },
          });
          const artifactVersion = (aggregate._max.version ?? 0) + 1;
          const preview = await tx.previewVersion.create({
            data: {
              layoutId: layout.id,
              version: artifactVersion,
              objectKey: previewKey,
              checksum,
              sizeBytes: BigInt(processed.output.length),
              sourceFileVersion: upload.fileVersion,
              settingsHash,
              originProcessingResultId: origin.id,
              pageCount: processed.metadata.pages,
            },
          });
          const printReady = await tx.printReadyVersion.create({
            data: {
              layoutId: layout.id,
              version: artifactVersion,
              objectKey: printReadyKey,
              checksum,
              sizeBytes: BigInt(processed.output.length),
              sourceFileVersion: upload.fileVersion,
              settingsHash,
              originProcessingResultId: origin.id,
              pageCount: processed.metadata.pages,
            },
          });
          await tx.permanentObjectReference.createMany({
            data: [
              {
                objectKey: previewKey,
                checksum,
                retentionClass: ObjectRetentionClass.PREVIEW,
                expiresAt: new Date(Date.now() + 30 * 86_400_000),
              },
              {
                objectKey: printReadyKey,
                checksum,
                retentionClass: ObjectRetentionClass.PRINT_READY,
                expiresAt: new Date(Date.now() + 30 * 86_400_000),
              },
            ],
          });
          if (requiresManualReview)
            await tx.manualReview.create({
              data: {
                layoutId: layout.id,
                previewVersionId: preview.id,
                reason: "PHOTO_CONFIDENCE_LOW",
              },
            });
          return {
            created: true,
            layout: await tx.layoutRequest.update({
              where: { id: layout.id },
              data: {
                latestPreviewId: preview.id,
                latestPrintReadyId: printReady.id,
                status: requiresManualReview
                  ? "MANUAL_REVIEW_REQUIRED"
                  : "AWAITING_APPROVAL",
                manualReviewReason: requiresManualReview
                  ? "PHOTO_CONFIDENCE_LOW"
                  : null,
                version: { increment: 1 },
              },
            }),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      if (!result.created)
        await Promise.all([
          this.storage.remove(previewKey).catch(() => undefined),
          this.storage.remove(printReadyKey).catch(() => undefined),
        ]);
      await this.audit.record("LAYOUT_PREFLIGHT_COMPLETED", userId, "layout", {
        status: result.layout.status,
        operation: "PREFLIGHT",
      });
      return view(result.layout);
    } catch (error) {
      await Promise.all([
        this.storage.remove(previewKey).catch(() => undefined),
        this.storage.remove(printReadyKey).catch(() => undefined),
      ]);
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return view(
          await this.prisma.layoutRequest.findUniqueOrThrow({
            where: { uploadId: upload.id },
          }),
        );
      }
      throw error;
    }
  }

  async own(userId: string, id: string) {
    return view(await this.owned(userId, id));
  }

  async previewUrl(userId: string, id: string) {
    const layout = await this.owned(userId, id);
    if (!layout.latestPreviewId) throw new ConflictException();
    const preview = await this.prisma.previewVersion.findFirstOrThrow({
      where: { id: layout.latestPreviewId, layoutId: layout.id },
    });
    return {
      url: await this.storage.signedGetUrl(
        preview.objectKey,
        this.env.previewSignedUrlTtlSeconds,
      ),
      expiresInSeconds: this.env.previewSignedUrlTtlSeconds,
      previewVersionId: preview.id,
    };
  }

  async confirm(userId: string, id: string, input: ConfirmLayoutDto) {
    try {
      const approved = await this.prisma.$transaction(
        async (tx) => {
          const layout = await tx.layoutRequest.findFirst({
            where: { id, userId },
          });
          if (!layout) throw new NotFoundException();
          if (
            layout.status !== "AWAITING_APPROVAL" ||
            layout.latestPreviewId !== input.previewVersionId
          )
            throw new ConflictException({ code: "STALE_PREVIEW_VERSION" });
          const preview = await tx.previewVersion.findFirst({
            where: {
              id: input.previewVersionId,
              layoutId: id,
              sourceFileVersion: layout.sourceFileVersion,
              settingsHash: layout.settingsHash,
            },
          });
          if (!preview)
            throw new ConflictException({ code: "STALE_PREVIEW_VERSION" });
          const approval = await tx.layoutApproval.create({
            data: {
              layoutId: id,
              previewVersionId: preview.id,
              userId,
              layoutVersion: layout.version,
            },
          });
          const changed = await tx.layoutRequest.updateMany({
            where: {
              id,
              userId,
              status: "AWAITING_APPROVAL",
              version: layout.version,
              latestPreviewId: preview.id,
            },
            data: {
              status: "APPROVED",
              currentApprovalId: approval.id,
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1)
            throw new ConflictException({ code: "APPROVAL_RACE_LOST" });
          return tx.layoutRequest.findUniqueOrThrow({ where: { id } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      await this.audit.record("LAYOUT_APPROVED", userId, "layout", {
        status: "APPROVED",
      });
      return view(approved);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(error.code)
      )
        throw new ConflictException({ code: "APPROVAL_RACE_LOST" });
      throw error;
    }
  }

  manualQueue() {
    return this.prisma.manualReview.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        layoutId: true,
        previewVersionId: true,
        status: true,
        reason: true,
        createdAt: true,
      },
      take: 100,
    });
  }

  async manualPreviewUrl(reviewId: string) {
    const review = await this.prisma.manualReview.findUnique({
      where: { id: reviewId },
      include: { previewVersion: true },
    });
    if (!review) throw new NotFoundException();
    return {
      url: await this.storage.signedGetUrl(
        review.previewVersion.objectKey,
        this.env.previewSignedUrlTtlSeconds,
      ),
      expiresInSeconds: this.env.previewSignedUrlTtlSeconds,
    };
  }

  async decideManualReview(
    reviewerId: string,
    reviewId: string,
    input: ManualReviewDecisionDto,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const review = await tx.manualReview.findUnique({
        where: { id: reviewId },
      });
      if (!review) throw new NotFoundException();
      if (review.status !== "PENDING") throw new ConflictException();
      const changed = await tx.manualReview.updateMany({
        where: { id: reviewId, status: "PENDING", version: review.version },
        data: {
          status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
          reviewerId,
          decisionAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ConflictException();
      const layout = await tx.layoutRequest.findUniqueOrThrow({
        where: { id: review.layoutId },
      });
      const layoutChanged = await tx.layoutRequest.updateMany({
        where: {
          id: review.layoutId,
          status: "MANUAL_REVIEW_REQUIRED",
          version: layout.version,
          latestPreviewId: review.previewVersionId,
        },
        data: {
          status:
            input.decision === "APPROVE"
              ? "AWAITING_APPROVAL"
              : "QUALITY_CHECK_FAILED",
          qualityCode:
            input.decision === "REJECT" ? "MANUAL_REVIEW_REJECTED" : null,
          manualReviewReason: null,
          version: { increment: 1 },
        },
      });
      if (layoutChanged.count !== 1) throw new ConflictException();
      return tx.layoutRequest.findUniqueOrThrow({
        where: { id: review.layoutId },
      });
    });
    await this.audit.record("MANUAL_REVIEW_DECIDED", reviewerId, "layout", {
      status: result.status,
      result: input.decision,
    });
    return view(result);
  }

  private async owned(userId: string, id: string) {
    const layout = await this.prisma.layoutRequest.findFirst({
      where: { id, userId },
    });
    if (!layout) throw new NotFoundException();
    return layout;
  }

  private markQualityFailure(id: string, code: string) {
    return this.prisma.layoutRequest.update({
      where: { id },
      data: {
        status: "QUALITY_CHECK_FAILED",
        qualityCode: code,
        manualReviewReason: null,
        currentApprovalId: null,
        version: { increment: 1 },
      },
    });
  }
}
