import { createHash } from "node:crypto";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type OrderDraftStatus } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { CommerceService } from "../commerce/commerce.service";
import { IdempotencyService } from "../commerce/idempotency.service";
import { PrismaService } from "../prisma/prisma.service";
import { UploadService } from "../uploads/upload.service";
import { LayoutsService } from "../layouts/layouts.service";
import {
  CatalogPolicyError,
  configurationHash,
  validateCatalogItem,
  validateConfiguration,
} from "./catalog-policy";
import type {
  CreateOrderDraftDto,
  DraftVersionDto,
  LinkDraftResourceDto,
  PublishCatalogDto,
  UpdateOrderDraftDto,
  StartDraftUploadDto,
} from "./dto";
import { calculateCustomerPrice } from "./pricing";
import { FulfillmentCrypto } from "../fulfillment/fulfillment.crypto";
import type { AppEnvironment } from "../config/environment";
import { APP_ENVIRONMENT } from "../uploads/private-object-storage.service";
import type { FulfillmentPreferenceDto } from "./dto";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const draftInclude = {
  catalogItem: true,
  upload: {
    select: { id: true, status: true, fileKind: true, rejectionCode: true },
  },
  layout: {
    select: {
      id: true,
      status: true,
      version: true,
      currentApprovalId: true,
      latestPreviewId: true,
      qualityCode: true,
      manualReviewReason: true,
    },
  },
  quotes: { orderBy: { sequence: "desc" as const }, take: 1 },
  order: { select: { id: true } },
  studioPreference: {
    include: {
      listing: { select: { publicSlug: true, titleRu: true, titleUz: true } },
    },
  },
  fulfillmentPreference: true,
} satisfies Prisma.OrderDraftInclude;

type DraftRow = Prisma.OrderDraftGetPayload<{ include: typeof draftInclude }>;

const stepFor = (draft: DraftRow) => {
  if (draft.status === "CANCELLED" || draft.status === "EXPIRED")
    return "closed";
  if (draft.order) return "order";
  if (!draft.uploadId) return "file";
  if (!draft.layoutId || draft.layout?.status === "PROCESSING")
    return "processing";
  if (
    [
      "QUALITY_CHECK_FAILED",
      "MANUAL_REVIEW_REQUIRED",
      "AWAITING_APPROVAL",
    ].includes(draft.layout?.status ?? "")
  )
    return "approval";
  if (!draft.layoutApprovalId) return "approval";
  if (
    draft.fulfillmentRequired &&
    (!draft.fulfillmentPreference || draft.fulfillmentPreference.invalidatedAt)
  )
    return "fulfillment";
  if (!draft.quotes[0] || draft.quotes[0].status !== "ACTIVE") return "quote";
  return "checkout";
};

const draftView = (draft: DraftRow) => ({
  id: draft.id,
  version: draft.version,
  service: {
    code: draft.serviceCode,
    slug: draft.catalogItem.slug,
    title:
      draft.locale === "uz"
        ? draft.catalogItem.titleUz
        : draft.catalogItem.titleRu,
  },
  locale: draft.locale,
  configuration: draft.configuration,
  quantity: draft.quantity,
  fulfillmentRequired: draft.fulfillmentRequired,
  fulfillmentPreference:
    draft.fulfillmentPreference && !draft.fulfillmentPreference.invalidatedAt
      ? {
          mode: draft.fulfillmentPreference.mode,
          locationCode: draft.fulfillmentPreference.locationCode,
          version: draft.fulfillmentPreference.version,
        }
      : null,
  studioPreference: draft.studioPreference
    ? {
        mode: draft.studioPreference.mode,
        fallbackPolicy: draft.studioPreference.fallbackPolicy,
        studio: draft.studioPreference.listing
          ? {
              slug: draft.studioPreference.listing.publicSlug,
              name:
                draft.locale === "uz"
                  ? draft.studioPreference.listing.titleUz
                  : draft.studioPreference.listing.titleRu,
            }
          : null,
      }
    : {
        mode: "AUTO_ASSIGN",
        fallbackPolicy: "ALLOW_ELIGIBLE_ALTERNATIVE",
        studio: null,
      },
  step: stepFor(draft),
  upload: draft.upload
    ? {
        accepted: !["REJECTED", "CANCELLED", "EXPIRED"].includes(
          draft.upload.status,
        ),
        ready: draft.upload.status === "READY",
        errorCode: draft.upload.rejectionCode,
      }
    : null,
  layout: draft.layout
    ? {
        presentation:
          draft.layout.status === "QUALITY_CHECK_FAILED"
            ? "quality_error"
            : draft.layout.status === "MANUAL_REVIEW_REQUIRED"
              ? "manual_review"
              : draft.layout.status === "AWAITING_APPROVAL"
                ? "approval"
                : draft.layout.status === "APPROVED"
                  ? "approved"
                  : "processing",
        qualityCode: draft.layout.qualityCode,
        previewAvailable: Boolean(draft.layout.latestPreviewId),
        approved: Boolean(draft.layout.currentApprovalId),
      }
    : null,
  quote: draft.quotes[0]
    ? {
        id: draft.quotes[0].id,
        totalMinor: draft.quotes[0].totalMinor.toString(),
        currency: draft.quotes[0].currency,
        expiresAt: draft.quotes[0].expiresAt,
        active:
          draft.quotes[0].status === "ACTIVE" &&
          draft.quotes[0].expiresAt > new Date(),
      }
    : null,
  orderPath: draft.order ? `/orders/${draft.order.id}` : null,
  expiresAt: draft.expiresAt,
});

@Injectable()
export class OrderingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(UploadService) private readonly uploads: UploadService,
    @Inject(LayoutsService) private readonly layouts: LayoutsService,
    @Inject(FulfillmentCrypto)
    private readonly fulfillmentCrypto: FulfillmentCrypto,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {}

  async catalog(locale: "ru" | "uz") {
    const version = await this.prisma.platformCatalogVersion.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { version: "desc" },
      include: {
        items: { where: { enabled: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    if (!version) throw new NotFoundException({ code: "CATALOG_UNAVAILABLE" });
    return {
      version: version.version,
      locale,
      services: version.items.map((item) => ({
        slug: item.slug,
        code: item.serviceCode,
        title: locale === "uz" ? item.titleUz : item.titleRu,
        description: locale === "uz" ? item.descriptionUz : item.descriptionRu,
        acceptedFileKinds: item.acceptedFileKinds,
        options: item.optionSchema,
      })),
    };
  }

  async publishCatalog(
    actorId: string,
    key: string | undefined,
    input: PublishCatalogDto,
  ) {
    const prepared = this.idempotency.prepare("catalog:publish", key, input);
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    if (input.items.length === 0 || input.items.length > 50)
      throw new ConflictException({ code: "INVALID_CATALOG" });
    let normalized: Array<
      ReturnType<typeof validateCatalogItem> & (typeof input.items)[number]
    >;
    try {
      normalized = input.items.map((item) => ({
        ...item,
        ...validateCatalogItem(item),
      }));
    } catch (error) {
      if (error instanceof CatalogPolicyError)
        throw new ConflictException({ code: error.safeCode });
      throw error;
    }
    if (
      new Set(normalized.map((item) => item.serviceCode)).size !==
      normalized.length
    )
      throw new ConflictException({ code: "DUPLICATE_SERVICE" });
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('platform-catalog'))`;
        const priorReplay = await tx.idempotencyRecord.findUnique({
          where: {
            scope_keyDigest: {
              scope: prepared.scope,
              keyDigest: prepared.keyDigest,
            },
          },
        });
        if (priorReplay)
          return this.idempotency.assertCompatible(priorReplay, prepared);
        const latest = await tx.platformCatalogVersion.findFirst({
          orderBy: { version: "desc" },
        });
        if (latest?.status === "ACTIVE")
          await tx.platformCatalogVersion.update({
            where: { id: latest.id },
            data: { status: "RETIRED", retiredAt: new Date() },
          });
        const created = await tx.platformCatalogVersion.create({
          data: {
            version: (latest?.version ?? 0) + 1,
            status: "ACTIVE",
            publishedAt: new Date(),
            createdById: actorId,
            items: {
              create: normalized.map((item) => ({
                serviceCode: item.serviceCode,
                slug: item.slug,
                titleRu: item.titleRu,
                titleUz: item.titleUz,
                descriptionRu: item.descriptionRu,
                descriptionUz: item.descriptionUz,
                acceptedFileKinds: item.acceptedFileKinds,
                optionSchema: item.optionSchema as Prisma.InputJsonValue,
                sortOrder: item.sortOrder ?? 100,
              })),
            },
          },
        });
        const response = { version: created.version, status: "published" };
        await tx.idempotencyRecord.create({
          data: this.idempotency.data(prepared, response),
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "catalog",
            aggregateId: created.id,
            aggregateVersion: created.version,
            eventType: "CATALOG_PUBLISHED",
            dedupKey: sha256(`catalog:${created.id}:${created.version}`),
            payload: { aggregateVersion: created.version },
          },
        });
        return response;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.audit.record("CATALOG_PUBLISHED", actorId, "catalog", {
      status: "ACTIVE",
    });
    return result;
  }

  async createDraft(
    userId: string,
    key: string | undefined,
    input: CreateOrderDraftDto,
  ) {
    const prepared = this.idempotency.prepare(
      `draft:create:${userId}`,
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const catalog = await this.prisma.platformCatalogVersion.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { version: "desc" },
      include: { items: { where: { slug: input.serviceSlug, enabled: true } } },
    });
    const item = catalog?.items[0];
    if (!catalog || !item)
      throw new NotFoundException({ code: "SERVICE_UNAVAILABLE" });
    let configuration: Record<string, unknown>;
    try {
      configuration = validateConfiguration(
        item.optionSchema,
        input.configuration,
      );
    } catch (error) {
      if (error instanceof CatalogPolicyError)
        throw new ConflictException({ code: error.safeCode });
      throw error;
    }
    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          const draft = await tx.orderDraft.create({
            data: {
              userId,
              catalogVersionId: catalog.id,
              catalogItemId: item.id,
              serviceCode: item.serviceCode,
              locale: input.locale,
              configuration: configuration as Prisma.InputJsonValue,
              quantity: input.quantity,
              fulfillmentRequired: this.env.stage13FulfillmentEnabled,
              expiresAt: new Date(Date.now() + 86_400_000),
            },
            include: draftInclude,
          });
          const response = draftView(draft as DraftRow);
          await tx.idempotencyRecord.create({
            data: this.idempotency.data(
              prepared,
              response as Prisma.InputJsonValue,
              201,
            ),
          });
          return response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return created;
    } catch (error) {
      return this.idempotencyRace(error, prepared);
    }
  }

  async listDrafts(userId: string) {
    const rows = await this.prisma.orderDraft.findMany({
      where: { userId },
      include: draftInclude,
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    return { drafts: rows.map(draftView) };
  }

  async ownDraft(userId: string, id: string) {
    const draft = await this.prisma.orderDraft.findFirst({
      where: { id, userId },
      include: draftInclude,
    });
    if (!draft) throw new NotFoundException();
    return draftView(draft);
  }

  async updateDraft(
    userId: string,
    id: string,
    key: string | undefined,
    input: UpdateOrderDraftDto,
  ) {
    const prepared = this.idempotency.prepare(
      `draft:update:${userId}:${id}`.slice(0, 80),
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    return this.mutateDraft(userId, id, prepared, async (tx, draft) => {
      if (["CHECKED_OUT", "CANCELLED", "EXPIRED"].includes(draft.status))
        throw new ConflictException({ code: "DRAFT_NOT_EDITABLE" });
      const configuration = validateConfiguration(
        draft.catalogItem.optionSchema,
        input.configuration,
      );
      await tx.priceQuote.updateMany({
        where: { draftId: id, status: "ACTIVE" },
        data: { status: "STALE" },
      });
      const changed = await tx.orderDraft.updateMany({
        where: { id, userId, version: input.version },
        data: {
          configuration: configuration as Prisma.InputJsonValue,
          quantity: input.quantity,
          status: draft.uploadId ? "FILE_UPLOADED" : "CONFIGURING",
          layoutId: null,
          layoutApprovalId: null,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException({ code: "DRAFT_VERSION_CONFLICT" });
    });
  }

  linkUpload(
    userId: string,
    id: string,
    key: string | undefined,
    input: LinkDraftResourceDto,
  ) {
    const prepared = this.idempotency.prepare(
      `draft:upload:${userId}:${id}`.slice(0, 80),
      key,
      input,
    );
    return this.mutateDraft(userId, id, prepared, async (tx, draft) => {
      const upload = await tx.uploadSession.findFirst({
        where: { id: input.resourceId, userId },
      });
      if (!upload) throw new NotFoundException();
      if (!draft.catalogItem.acceptedFileKinds.includes(upload.fileKind))
        throw new ConflictException({ code: "FILE_NOT_ALLOWED_FOR_SERVICE" });
      const changed = await tx.orderDraft.updateMany({
        where: { id, userId, version: input.version },
        data: {
          uploadId: upload.id,
          layoutId: null,
          layoutApprovalId: null,
          status: "FILE_UPLOADED",
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException({ code: "DRAFT_VERSION_CONFLICT" });
    });
  }

  async startUpload(
    userId: string,
    id: string,
    key: string | undefined,
    input: StartDraftUploadDto,
  ) {
    const prepared = this.idempotency.prepare(
      `draft:start-upload:${userId}:${id}`.slice(0, 80),
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const draft = await this.prisma.orderDraft.findFirst({
      where: { id, userId },
      include: { catalogItem: true },
    });
    if (!draft) throw new NotFoundException();
    if (draft.version !== input.version || draft.uploadId)
      throw new ConflictException({ code: "DRAFT_VERSION_CONFLICT" });
    const kind =
      input.extension === "jpg" || input.extension === "jpeg"
        ? "JPEG"
        : input.extension.toUpperCase();
    if (!draft.catalogItem.acceptedFileKinds.includes(kind as never))
      throw new ConflictException({ code: "FILE_NOT_ALLOWED_FOR_SERVICE" });
    const upload = await this.uploads.create(userId, input);
    try {
      return await this.mutateDraft(userId, id, prepared, async (tx) => {
        const changed = await tx.orderDraft.updateMany({
          where: { id, userId, version: input.version, uploadId: null },
          data: {
            uploadId: upload.id,
            status: "FILE_UPLOADED",
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1)
          throw new ConflictException({ code: "DRAFT_VERSION_CONFLICT" });
      });
    } catch (error) {
      await this.uploads.cancel(userId, upload.id).catch(() => undefined);
      throw error;
    }
  }

  async putContent(userId: string, id: string, value: Buffer) {
    const draft = await this.prisma.orderDraft.findFirst({
      where: { id, userId },
      select: { uploadId: true },
    });
    if (!draft?.uploadId) throw new NotFoundException();
    await this.uploads.putContent(userId, draft.uploadId, value);
    return this.ownDraft(userId, id);
  }

  async createLayout(
    userId: string,
    id: string,
    key: string | undefined,
    input: DraftVersionDto,
  ) {
    const prepared = this.idempotency.prepare(
      `draft:create-layout:${userId}:${id}`.slice(0, 80),
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const draft = await this.prisma.orderDraft.findFirst({
      where: { id, userId },
      include: { upload: true },
    });
    if (!draft?.uploadId || draft.upload?.status !== "READY")
      throw new ConflictException({ code: "FILE_PROCESSING_NOT_READY" });
    if (draft.version !== input.version)
      throw new ConflictException({ code: "DRAFT_VERSION_CONFLICT" });
    const config = draft.configuration as Record<string, unknown>;
    const width = Number(config.WIDTH_MM);
    const height = Number(config.HEIGHT_MM);
    const dpi = Number(config.MIN_DPI);
    if (![width, height, dpi].every(Number.isInteger))
      throw new ConflictException({ code: "INVALID_LAYOUT_OPTIONS" });
    const layout = await this.layouts.generate(userId, {
      uploadId: draft.uploadId,
      targetWidthMm: width,
      targetHeightMm: height,
      minDpi: dpi,
      photoDocument: config.PHOTO_DOCUMENT === "YES",
      customerConfigurationHash: configurationHash(draft.configuration),
    });
    return this.mutateDraft(userId, id, prepared, async (tx) => {
      const changed = await tx.orderDraft.updateMany({
        where: { id, userId, version: input.version },
        data: {
          layoutId: layout.id,
          status: "PROCESSING",
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException({ code: "DRAFT_VERSION_CONFLICT" });
    });
  }

  async previewUrl(userId: string, id: string) {
    const draft = await this.prisma.orderDraft.findFirst({
      where: { id, userId },
      select: { layoutId: true },
    });
    if (!draft?.layoutId) throw new NotFoundException();
    return this.layouts.previewUrl(userId, draft.layoutId);
  }

  async approve(
    userId: string,
    id: string,
    key: string | undefined,
    input: DraftVersionDto,
  ) {
    const prepared = this.idempotency.prepare(
      `draft:approve:${userId}:${id}`.slice(0, 80),
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const draft = await this.prisma.orderDraft.findFirst({
      where: { id, userId },
      include: { layout: true },
    });
    if (!draft?.layout || !draft.layout.latestPreviewId)
      throw new ConflictException({ code: "PREVIEW_NOT_READY" });
    if (draft.version !== input.version)
      throw new ConflictException({ code: "DRAFT_VERSION_CONFLICT" });
    const approved = await this.layouts.confirm(userId, draft.layout.id, {
      previewVersionId: draft.layout.latestPreviewId,
    });
    return this.mutateDraft(userId, id, prepared, async (tx) => {
      const changed = await tx.orderDraft.updateMany({
        where: { id, userId, version: input.version },
        data: {
          layoutApprovalId: approved.currentApprovalId,
          status: "READY_FOR_QUOTE",
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException({ code: "DRAFT_VERSION_CONFLICT" });
    });
  }

  linkLayout(
    userId: string,
    id: string,
    key: string | undefined,
    input: LinkDraftResourceDto,
  ) {
    const prepared = this.idempotency.prepare(
      `draft:layout:${userId}:${id}`.slice(0, 80),
      key,
      input,
    );
    return this.mutateDraft(userId, id, prepared, async (tx, draft) => {
      const layout = await tx.layoutRequest.findFirst({
        where: { id: input.resourceId, userId },
      });
      if (!layout || layout.uploadId !== draft.uploadId)
        throw new NotFoundException();
      const changed = await tx.orderDraft.updateMany({
        where: { id, userId, version: input.version },
        data: {
          layoutId: layout.id,
          status: "PROCESSING",
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException({ code: "DRAFT_VERSION_CONFLICT" });
    });
  }

  async syncDraft(
    userId: string,
    id: string,
    key: string | undefined,
    input: DraftVersionDto,
  ) {
    const prepared = this.idempotency.prepare(
      `draft:sync:${userId}:${id}`.slice(0, 80),
      key,
      input,
    );
    return this.mutateDraft(userId, id, prepared, async (tx, draft) => {
      if (!draft.layoutId)
        throw new ConflictException({ code: "LAYOUT_NOT_CREATED" });
      const layout = await tx.layoutRequest.findUniqueOrThrow({
        where: { id: draft.layoutId },
      });
      let status: OrderDraftStatus = "PROCESSING";
      if (
        layout.status === "AWAITING_APPROVAL" ||
        layout.status === "MANUAL_REVIEW_REQUIRED" ||
        layout.status === "QUALITY_CHECK_FAILED"
      )
        status = "AWAITING_APPROVAL";
      if (layout.status === "APPROVED" && layout.currentApprovalId)
        status = "READY_FOR_QUOTE";
      const changed = await tx.orderDraft.updateMany({
        where: { id, userId, version: input.version },
        data: {
          status,
          layoutApprovalId: layout.currentApprovalId,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException({ code: "DRAFT_VERSION_CONFLICT" });
    });
  }

  async fulfillmentOptions(userId: string, id: string) {
    const draft = await this.prisma.orderDraft.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!draft) throw new NotFoundException();
    const tariff = await this.prisma.tariffVersion.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { version: "desc" },
      include: {
        fulfillmentRules: {
          where: { enabled: true },
          orderBy: [{ mode: "asc" }, { locationCode: "asc" }],
        },
      },
    });
    if (!tariff) throw new ConflictException({ code: "NO_ACTIVE_TARIFF" });
    return {
      currency: tariff.currency,
      options: tariff.fulfillmentRules.map((rule) => ({
        mode: rule.mode,
        locationCode: rule.locationCode,
        feeMinor: rule.feeMinor.toString(),
      })),
    };
  }

  async setFulfillmentPreference(
    userId: string,
    id: string,
    key: string | undefined,
    input: FulfillmentPreferenceDto,
  ) {
    const prepared = this.idempotency.prepare(
      `draft:fulfillment:${userId}:${id}`.slice(0, 80),
      key,
      input,
    );
    return this.mutateDraft(userId, id, prepared, async (tx, draft) => {
      if (["CHECKED_OUT", "CANCELLED", "EXPIRED"].includes(draft.status))
        throw new ConflictException({ code: "DRAFT_NOT_EDITABLE" });
      if (!draft.layoutApprovalId)
        throw new ConflictException({ code: "LAYOUT_APPROVAL_REQUIRED" });
      const isPickup = input.mode === "PICKUP";
      if (
        (isPickup && (input.locationCode !== "PICKUP" || input.address)) ||
        (!isPickup &&
          (input.locationCode === "PICKUP" ||
            !input.address ||
            input.address.trim().length < 5))
      )
        throw new ConflictException({ code: "INVALID_FULFILLMENT_SELECTION" });
      const tariff = await tx.tariffVersion.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { version: "desc" },
        include: { fulfillmentRules: true },
      });
      const rule = tariff?.fulfillmentRules.find(
        (candidate) =>
          candidate.enabled &&
          candidate.mode === input.mode &&
          candidate.locationCode === input.locationCode,
      );
      if (!rule)
        throw new ConflictException({ code: "FULFILLMENT_UNAVAILABLE" });
      const encrypted = isPickup
        ? {
            addressCiphertext: null,
            addressIv: null,
            addressAuthTag: null,
          }
        : this.fulfillmentCrypto.encryptAddress(input.address!.trim());
      await tx.priceQuote.updateMany({
        where: { draftId: id, status: "ACTIVE" },
        data: { status: "STALE" },
      });
      await tx.orderDraftFulfillmentPreference.upsert({
        where: { draftId: id },
        create: {
          draftId: id,
          mode: input.mode,
          locationCode: input.locationCode,
          ...encrypted,
          invalidatedAt: null,
        },
        update: {
          mode: input.mode,
          locationCode: input.locationCode,
          ...encrypted,
          version: { increment: 1 },
          invalidatedAt: null,
        },
      });
      const changed = await tx.orderDraft.updateMany({
        where: { id, userId, version: input.version },
        data: {
          fulfillmentRequired: true,
          status: "READY_FOR_QUOTE",
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException({ code: "DRAFT_VERSION_CONFLICT" });
      await tx.auditEvent.create({
        data: {
          actorId: userId,
          eventType: "FULFILLMENT_PREFERENCE_SET",
          targetType: "order-draft",
          metadata: { operation: input.mode, status: "ACTIVE" },
        },
      });
    });
  }

  async clearFulfillmentPreference(
    userId: string,
    id: string,
    key: string | undefined,
    input: DraftVersionDto,
  ) {
    const prepared = this.idempotency.prepare(
      `draft:fulfillment-clear:${userId}:${id}`.slice(0, 80),
      key,
      input,
    );
    return this.mutateDraft(userId, id, prepared, async (tx) => {
      await tx.priceQuote.updateMany({
        where: { draftId: id, status: "ACTIVE" },
        data: { status: "STALE" },
      });
      await tx.orderDraftFulfillmentPreference.updateMany({
        where: { draftId: id, invalidatedAt: null },
        data: {
          mode: "PICKUP",
          locationCode: "PICKUP",
          addressCiphertext: null,
          addressIv: null,
          addressAuthTag: null,
          invalidatedAt: new Date(),
          version: { increment: 1 },
        },
      });
      const changed = await tx.orderDraft.updateMany({
        where: { id, userId, version: input.version },
        data: { status: "READY_FOR_QUOTE", version: { increment: 1 } },
      });
      if (changed.count !== 1)
        throw new ConflictException({ code: "DRAFT_VERSION_CONFLICT" });
      await tx.auditEvent.create({
        data: {
          actorId: userId,
          eventType: "FULFILLMENT_PREFERENCE_CLEARED",
          targetType: "order-draft",
          metadata: { status: "CLEARED" },
        },
      });
    });
  }

  async quote(
    userId: string,
    id: string,
    key: string | undefined,
    input: DraftVersionDto,
  ) {
    const prepared = this.idempotency.prepare(
      `draft:quote:${userId}:${id}`.slice(0, 80),
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "OrderDraft" WHERE id = ${id}::uuid FOR UPDATE`;
          const prior = await tx.idempotencyRecord.findUnique({
            where: {
              scope_keyDigest: {
                scope: prepared.scope,
                keyDigest: prepared.keyDigest,
              },
            },
          });
          if (prior) return this.idempotency.assertCompatible(prior, prepared);
          const draft = await tx.orderDraft.findFirst({
            where: { id, userId },
            include: {
              catalogItem: true,
              catalogVersion: true,
              layout: { include: { upload: true, printReadyVersions: true } },
              quotes: true,
              fulfillmentPreference: true,
            },
          });
          if (!draft) throw new NotFoundException();
          if (draft.version !== input.version)
            throw new ConflictException({ code: "DRAFT_VERSION_CONFLICT" });
          const layout = draft.layout;
          if (
            !layout ||
            layout.status !== "APPROVED" ||
            !layout.currentApprovalId ||
            layout.currentApprovalId !== draft.layoutApprovalId ||
            !layout.latestPrintReadyId
          )
            throw new ConflictException({
              code: "LAYOUT_APPROVAL_NOT_CURRENT",
            });
          if (draft.catalogVersion.status !== "ACTIVE")
            throw new ConflictException({ code: "CATALOG_CHANGED" });
          const tariff = await tx.tariffVersion.findFirst({
            where: { status: "ACTIVE" },
            orderBy: { version: "desc" },
            include: { rules: true, fulfillmentRules: true },
          });
          if (!tariff)
            throw new ConflictException({ code: "NO_ACTIVE_TARIFF" });
          const rule = tariff.rules.find(
            (item) => item.serviceCode === draft.serviceCode,
          );
          const fulfillmentPreference = draft.fulfillmentPreference
            ?.invalidatedAt
            ? undefined
            : draft.fulfillmentPreference;
          const fulfillmentRule = fulfillmentPreference
            ? tariff.fulfillmentRules.find(
                (candidate) =>
                  candidate.enabled &&
                  candidate.mode === fulfillmentPreference.mode &&
                  candidate.locationCode === fulfillmentPreference.locationCode,
              )
            : undefined;
          if (draft.fulfillmentRequired && !fulfillmentPreference)
            throw new ConflictException({
              code: "FULFILLMENT_SELECTION_REQUIRED",
            });
          if (fulfillmentPreference && !fulfillmentRule)
            throw new ConflictException({ code: "FULFILLMENT_UNAVAILABLE" });
          const priced = calculateCustomerPrice({
            basePriceMinor: rule?.basePriceMinor ?? tariff.basePriceMinor,
            perPagePriceMinor:
              rule?.perPagePriceMinor ?? tariff.perPagePriceMinor,
            optionPrices: rule?.optionPrices ?? {},
            pageCount:
              layout.printReadyVersions.find(
                (item) => item.id === layout.latestPrintReadyId,
              )?.pageCount ?? 0,
            quantity: draft.quantity,
            configuration: draft.configuration as Record<string, unknown>,
            fulfillmentFeeMinor: fulfillmentRule?.feeMinor,
          });
          await tx.priceQuote.updateMany({
            where: { draftId: id, status: "ACTIVE" },
            data: { status: "STALE" },
          });
          const nextVersion = draft.version + 1;
          const quote = await tx.priceQuote.create({
            data: {
              draftId: id,
              sequence: draft.quotes.length + 1,
              draftVersion: nextVersion,
              catalogVersionId: draft.catalogVersionId,
              catalogItemId: draft.catalogItemId,
              tariffVersionId: tariff.id,
              tariffVersion: tariff.version,
              layoutVersion: layout.version,
              layoutApprovalId: layout.currentApprovalId,
              sourceParameters: {
                serviceCode: draft.serviceCode,
                configuration: draft.configuration,
                fileKind: layout.upload.fileKind,
                pageCount:
                  layout.printReadyVersions.find(
                    (item) => item.id === layout.latestPrintReadyId,
                  )?.pageCount ?? 0,
                fulfillment: fulfillmentPreference
                  ? {
                      mode: fulfillmentPreference.mode,
                      locationCode: fulfillmentPreference.locationCode,
                    }
                  : undefined,
              },
              lineItems: priced.lineItems,
              quantity: draft.quantity,
              subtotalMinor: priced.subtotalMinor,
              discountMinor: priced.discountMinor,
              totalMinor: priced.totalMinor,
              fulfillmentPreferenceVersion: fulfillmentPreference?.version,
              fulfillmentTariffRuleId: fulfillmentRule?.id,
              expiresAt: new Date(Date.now() + 15 * 60_000),
            },
          });
          await tx.orderDraft.update({
            where: { id },
            data: { status: "QUOTED", version: nextVersion },
          });
          const response = {
            id: quote.id,
            totalMinor: quote.totalMinor.toString(),
            currency: quote.currency,
            expiresAt: quote.expiresAt,
            draftVersion: nextVersion,
          };
          await tx.idempotencyRecord.create({
            data: this.idempotency.data(
              prepared,
              response as Prisma.InputJsonValue,
              201,
            ),
          });
          return response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      return this.idempotencyRace(error, prepared);
    }
  }

  async checkout(
    userId: string,
    id: string,
    key: string | undefined,
    input: DraftVersionDto,
  ) {
    const draft = await this.prisma.orderDraft.findFirst({
      where: { id, userId },
      include: {
        quotes: {
          orderBy: { sequence: "desc" },
          take: 1,
        },
      },
    });
    if (!draft) throw new NotFoundException();
    const quote = draft.quotes[0];
    if (!quote || !draft.layoutApprovalId)
      throw new ConflictException({ code: "QUOTE_REQUIRED" });
    return this.commerce.createOrder(userId, key, {
      layoutApprovalId: draft.layoutApprovalId,
      quantity: draft.quantity,
      orderDraftId: draft.id,
      priceQuoteId: quote.id,
      orderDraftVersion: input.version,
    });
  }

  async cancel(
    userId: string,
    id: string,
    key: string | undefined,
    input: DraftVersionDto,
  ) {
    const prepared = this.idempotency.prepare(
      `draft:cancel:${userId}:${id}`.slice(0, 80),
      key,
      input,
    );
    return this.mutateDraft(userId, id, prepared, async (tx, draft) => {
      if (draft.order)
        throw new ConflictException({ code: "DRAFT_ALREADY_CHECKED_OUT" });
      await tx.priceQuote.updateMany({
        where: { draftId: id, status: "ACTIVE" },
        data: { status: "STALE" },
      });
      const changed = await tx.orderDraft.updateMany({
        where: { id, userId, version: input.version },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException({ code: "DRAFT_VERSION_CONFLICT" });
    });
  }

  async ownOrders(userId: string) {
    const rows = await this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { priceSnapshot: true },
    });
    return {
      orders: rows.map((order) => ({
        id: order.id,
        presentation: this.orderPresentation(order.status),
        totalMinor: order.priceSnapshot?.totalMinor.toString() ?? null,
        currency: order.priceSnapshot?.currency ?? null,
        createdAt: order.createdAt,
      })),
    };
  }

  async timeline(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { customerEvents: { orderBy: { sequence: "asc" } } },
    });
    if (!order) throw new NotFoundException();
    return {
      current: this.orderPresentation(order.status),
      events: order.customerEvents.map((event) => ({
        presentation: this.eventPresentation(event.eventCode),
        at: event.createdAt,
      })),
    };
  }

  async notifications(userId: string, locale: "ru" | "uz") {
    const rows = await this.prisma.userNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      notifications: rows.map((row) => ({
        id: row.id,
        status: row.status === "READ" ? "read" : "unread",
        title: this.localized(row.titleKey, locale),
        message: this.localized(row.bodyKey, locale),
        createdAt: row.createdAt,
      })),
    };
  }

  async readNotification(
    userId: string,
    notificationId: string,
    key: string | undefined,
  ) {
    const prepared = this.idempotency.prepare(
      `notification:read:${userId}`.slice(0, 80),
      key,
      { notificationId },
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const row = await this.prisma.userNotification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!row) throw new NotFoundException();
    const response = { status: "read" };
    await this.prisma.$transaction([
      this.prisma.userNotification.update({
        where: { id: row.id },
        data: { status: "READ", readAt: row.readAt ?? new Date() },
      }),
      this.prisma.idempotencyRecord.create({
        data: this.idempotency.data(prepared, response),
      }),
    ]);
    return response;
  }

  private async mutateDraft(
    userId: string,
    id: string,
    prepared: ReturnType<IdempotencyService["prepare"]>,
    mutation: (tx: Prisma.TransactionClient, draft: DraftRow) => Promise<void>,
  ) {
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const prior = await tx.idempotencyRecord.findUnique({
            where: {
              scope_keyDigest: {
                scope: prepared.scope,
                keyDigest: prepared.keyDigest,
              },
            },
          });
          if (prior) return this.idempotency.assertCompatible(prior, prepared);
          const draft = await tx.orderDraft.findFirst({
            where: { id, userId },
            include: draftInclude,
          });
          if (!draft) throw new NotFoundException();
          await mutation(tx, draft);
          const current = await tx.orderDraft.findUniqueOrThrow({
            where: { id },
            include: draftInclude,
          });
          const response = draftView(current);
          await tx.idempotencyRecord.create({
            data: this.idempotency.data(
              prepared,
              response as Prisma.InputJsonValue,
            ),
          });
          return response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof CatalogPolicyError)
        throw new ConflictException({ code: error.safeCode });
      return this.idempotencyRace(error, prepared);
    }
  }

  private async idempotencyRace(
    error: unknown,
    prepared: ReturnType<IdempotencyService["prepare"]>,
  ) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2034"].includes(error.code)
    ) {
      const replay =
        await this.idempotency.replay<Record<string, unknown>>(prepared);
      if (replay) return replay;
      throw new ConflictException({ code: "CONCURRENT_CHANGE" });
    }
    throw error;
  }

  private orderPresentation(status: string) {
    if (["COMPLETED"].includes(status)) return "completed";
    if (["REFUNDED", "PARTIALLY_REFUNDED"].includes(status)) return "refunded";
    if (
      ["DELIVERY_FAILED", "PROCESSING_FAILED", "QUALITY_CHECK_FAILED"].includes(
        status,
      )
    )
      return "attention";
    if (["AWAITING_PAYMENT"].includes(status)) return "payment";
    if (["READY", "AWAITING_PICKUP"].includes(status)) return "ready";
    if (["COURIER_ASSIGNED", "IN_DELIVERY"].includes(status)) return "delivery";
    return "in_progress";
  }

  private eventPresentation(code: string) {
    const map: Record<string, string> = {
      ORDER_CREATED: "created",
      PAYMENT_SUCCEEDED: "paid",
      PARTNER_ASSIGNED: "partner_assigned",
      ORDER_IN_PRODUCTION: "production",
      ORDER_READY: "ready",
      PICKUP_REQUESTED: "ready",
      DELIVERY_REQUESTED: "delivery",
      ORDER_IN_DELIVERY: "delivery",
      ORDER_COMPLETED: "completed",
      DELIVERY_FAILED: "delivery_failed",
      REFUND_CONFIRMED: "refunded",
    };
    return map[code] ?? "updated";
  }

  private localized(key: string, locale: "ru" | "uz") {
    const messages: Record<string, [string, string]> = {
      "order.created.title": ["Заказ создан", "Buyurtma yaratildi"],
      "order.created.body": [
        "Можно продолжить оплату.",
        "To‘lovni davom ettirishingiz mumkin.",
      ],
      "order.updated.title": [
        "Статус заказа обновлён",
        "Buyurtma holati yangilandi",
      ],
      "order.updated.body": [
        "Откройте заказ, чтобы увидеть следующий шаг.",
        "Keyingi qadamni ko‘rish uchun buyurtmani oching.",
      ],
      "order.attention.title": [
        "Заказ требует внимания",
        "Buyurtma e’tibor talab qiladi",
      ],
      "order.ready.title": ["Заказ готов", "Buyurtma tayyor"],
      "order.completed.title": ["Заказ завершён", "Buyurtma bajarildi"],
      "order.paid.body": [
        "Оплата получена. Ищем подходящую студию.",
        "To‘lov qabul qilindi. Mos studiya qidirilmoqda.",
      ],
      "order.payment_failed.body": [
        "Оплата не завершена. Её можно безопасно повторить.",
        "To‘lov yakunlanmadi. Uni xavfsiz takrorlash mumkin.",
      ],
      "order.partner.body": [
        "Подходящая студия приняла заказ.",
        "Mos studiya buyurtmani qabul qildi.",
      ],
      "order.production.body": [
        "Студия начала печать.",
        "Studiya chop etishni boshladi.",
      ],
      "order.ready.body": [
        "Заказ можно получить выбранным способом.",
        "Buyurtmani tanlangan usulda olish mumkin.",
      ],
      "order.delivery_requested.body": [
        "Оформляем передачу заказа курьеру.",
        "Buyurtmani kuryerga topshirish rasmiylashtirilmoqda.",
      ],
      "order.pickup_requested.body": [
        "Заказ ожидает получения в студии.",
        "Buyurtma studiyada olib ketishni kutmoqda.",
      ],
      "order.delivery.body": [
        "Заказ находится в доставке.",
        "Buyurtma yetkazilmoqda.",
      ],
      "order.completed.body": [
        "Заказ успешно получен.",
        "Buyurtma muvaffaqiyatli olindi.",
      ],
      "order.delivery_failed.body": [
        "Доставка не состоялась. Откройте заказ для дальнейших действий.",
        "Yetkazib berilmadi. Keyingi amal uchun buyurtmani oching.",
      ],
      "order.refunded.body": [
        "Возврат подтверждён.",
        "Pul qaytarilishi tasdiqlandi.",
      ],
    };
    const value = messages[key] ?? messages["order.updated.body"]!;
    return value[locale === "uz" ? 1 : 0];
  }
}
