import { createHash } from "node:crypto";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { MapsProvider } from "@agat/providers";
import { IdempotencyService } from "../commerce/idempotency.service";
import { isOpenAt, type WeeklyWindow } from "../matching/network-policy";
import { PrismaService } from "../prisma/prisma.service";
import { MAPS_PROVIDER } from "../providers/provider-tokens";
import type {
  ListingDecisionDto,
  ListingDraftDto,
  StudioPreferenceDto,
  StudioQueryDto,
} from "./dto";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const outbox = (
  aggregateType: string,
  aggregateId: string,
  aggregateVersion: number,
  eventType: string,
): Prisma.OutboxEventCreateInput => ({
  aggregateType,
  aggregateId,
  aggregateVersion,
  eventType,
  dedupKey: digest(
    `${aggregateType}:${aggregateId}:${aggregateVersion}:${eventType}`,
  ),
  payload: { aggregateId, aggregateVersion },
});

const listingInclude = {
  branch: {
    include: {
      partner: true,
      capabilityVersions: {
        where: { status: "ACTIVE" as const },
        orderBy: { version: "desc" as const },
        take: 1,
      },
      operationalVersions: {
        where: { status: "ACTIVE" as const },
        orderBy: { version: "desc" as const },
        take: 1,
      },
      catalogVersions: {
        where: { status: "ACTIVE" as const },
        orderBy: { version: "desc" as const },
        take: 1,
        include: { items: true },
      },
      capacityVersions: {
        where: { status: "ACTIVE" as const },
        orderBy: { version: "desc" as const },
        take: 1,
      },
      availabilityExceptions: {
        where: { cancelledAt: null },
        orderBy: { startsAt: "asc" as const },
        take: 20,
      },
      _count: {
        select: {
          assignments: { where: { active: true } },
          capacityReservations: { where: { status: "HELD" as const } },
        },
      },
    },
  },
} satisfies Prisma.StudioListingVersionInclude;
type ListingRow = Prisma.StudioListingVersionGetPayload<{
  include: typeof listingInclude;
}>;

@Injectable()
export class MarketplaceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(MAPS_PROVIDER) private readonly maps: MapsProvider,
  ) {}

  async list(query: StudioQueryDto) {
    const rows = await this.prisma.studioListingVersion.findMany({
      where: {
        status: "PUBLISHED",
        branch: {
          active: true,
          acceptingOrders: true,
          locationCode: query.locationCode,
          partner: { status: { in: ["ACTIVE", "APPROVED"] } },
        },
      },
      include: listingInclude,
      orderBy: [{ publishedAt: "desc" }, { publicSlug: "asc" }],
      take: query.limit ?? 30,
    });
    return {
      studios: await Promise.all(
        rows
          .filter((row) => this.compatible(row, query))
          .map((row) => this.publicView(row, query.locale ?? "ru", query)),
      ),
    };
  }

  async detail(slug: string, locale: "ru" | "uz") {
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(slug)) throw new NotFoundException();
    const row = await this.prisma.studioListingVersion.findFirst({
      where: {
        publicSlug: slug,
        status: "PUBLISHED",
        branch: {
          active: true,
          acceptingOrders: true,
          partner: { status: { in: ["ACTIVE", "APPROVED"] } },
        },
      },
      include: listingInclude,
    });
    if (!row) throw new NotFoundException();
    return this.publicView(row, locale, {});
  }

  async partnerListings(ownerId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { ownerId },
      include: {
        branches: {
          include: {
            studioListings: { orderBy: { sequence: "desc" }, take: 10 },
          },
        },
      },
    });
    if (!partner) throw new NotFoundException();
    return {
      branches: partner.branches.map((branch) => ({
        branchId: branch.id,
        branchName: branch.name,
        listings: branch.studioListings.map((row) => this.ownerView(row)),
      })),
    };
  }

  async saveDraft(
    ownerId: string,
    key: string | undefined,
    input: ListingDraftDto,
  ) {
    return this.run(
      `studio-listing:${ownerId}:${input.branchId}:draft`,
      key,
      input,
      async (tx) => {
        const branch = await tx.branch.findFirst({
          where: {
            id: input.branchId,
            partner: {
              ownerId,
              status: { in: ["ACTIVE", "APPROVED", "SUSPENDED"] },
            },
          },
        });
        if (!branch) throw new NotFoundException();
        const current = await tx.studioListingVersion.findFirst({
          where: { branchId: branch.id, status: "DRAFT" },
          orderBy: { sequence: "desc" },
        });
        const latest = current
          ? null
          : await tx.studioListingVersion.aggregate({
              where: { branchId: branch.id },
              _max: { sequence: true },
            });
        const row = current
          ? await tx.studioListingVersion.update({
              where: { id: current.id },
              data: this.copy(input),
            })
          : await tx.studioListingVersion.create({
              data: {
                branchId: branch.id,
                sequence: (latest?._max.sequence ?? 0) + 1,
                createdById: ownerId,
                ...this.copy(input),
              },
            });
        await this.audit(
          tx,
          ownerId,
          "STUDIO_LISTING_DRAFT_SAVED",
          "DRAFT",
          "SAVE",
        );
        return this.ownerView(row);
      },
    );
  }

  async submit(
    ownerId: string,
    id: string,
    key: string | undefined,
    version: number,
  ) {
    return this.run(
      `studio-listing:${ownerId}:${id}:submit`,
      key,
      { version },
      async (tx) => {
        const row = await tx.studioListingVersion.findFirst({
          where: {
            id,
            sequence: version,
            status: "DRAFT",
            branch: { partner: { ownerId } },
          },
        });
        if (!row)
          throw new ConflictException({ code: "LISTING_VERSION_CONFLICT" });
        const updated = await tx.studioListingVersion.update({
          where: { id },
          data: { status: "SUBMITTED", submittedAt: new Date() },
        });
        await tx.outboxEvent.create({
          data: outbox(
            "studio-listing",
            updated.id,
            updated.sequence,
            "STUDIO_LISTING_SUBMITTED",
          ),
        });
        await this.audit(
          tx,
          ownerId,
          "STUDIO_LISTING_SUBMITTED",
          "SUBMITTED",
          "SUBMIT",
        );
        return this.ownerView(updated);
      },
    );
  }

  async moderationQueue() {
    const rows = await this.prisma.studioListingVersion.findMany({
      where: { status: { in: ["SUBMITTED", "PUBLISHED"] } },
      include: {
        branch: {
          select: {
            name: true,
            city: true,
            district: true,
            partner: { select: { displayName: true, status: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    return {
      listings: rows.map((row) => ({
        id: row.id,
        version: row.sequence,
        status: row.status,
        publicSlug: row.publicSlug,
        titleRu: row.titleRu,
        titleUz: row.titleUz,
        descriptionRu: row.descriptionRu,
        descriptionUz: row.descriptionUz,
        branchName: row.branch.name,
        partnerName: row.branch.partner.displayName,
        partnerStatus: row.branch.partner.status,
        city: row.branch.city,
        district: row.branch.district,
      })),
    };
  }

  async decide(
    actorId: string,
    id: string,
    key: string | undefined,
    input: ListingDecisionDto,
  ) {
    return this.run(
      `admin:studio-listing:${id}:decision`,
      key,
      input,
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "StudioListingVersion" WHERE id = ${id}::uuid FOR UPDATE`;
        const row = await tx.studioListingVersion.findUnique({
          where: { id },
          include: listingInclude,
        });
        if (!row || row.sequence !== input.version)
          throw new ConflictException({ code: "LISTING_VERSION_CONFLICT" });
        if (input.decision === "PUBLISH") {
          if (row.status !== "SUBMITTED" || !this.networkConfigured(row))
            throw new ConflictException({ code: "LISTING_NOT_ELIGIBLE" });
          await tx.studioListingVersion.updateMany({
            where: {
              branchId: row.branchId,
              status: "PUBLISHED",
              id: { not: row.id },
            },
            data: {
              status: "RETIRED",
              retiredAt: new Date(),
              moderatedById: actorId,
              moderationCode: "RETIRED_BY_OPERATOR",
            },
          });
        } else if (input.decision === "REJECT" && row.status !== "SUBMITTED")
          throw new ConflictException({ code: "LISTING_NOT_SUBMITTED" });
        else if (input.decision === "RETIRE" && row.status !== "PUBLISHED")
          throw new ConflictException({ code: "LISTING_NOT_PUBLISHED" });
        const status =
          input.decision === "PUBLISH"
            ? "PUBLISHED"
            : input.decision === "REJECT"
              ? "REJECTED"
              : "RETIRED";
        const updated = await tx.studioListingVersion.update({
          where: { id },
          data: {
            status,
            moderatedById: actorId,
            moderationCode:
              input.reasonCode ??
              (status === "PUBLISHED"
                ? "APPROVED"
                : status === "REJECTED"
                  ? "CONTENT_POLICY"
                  : "RETIRED_BY_OPERATOR"),
            publishedAt: status === "PUBLISHED" ? new Date() : row.publishedAt,
            retiredAt: status === "RETIRED" ? new Date() : null,
          },
        });
        await tx.outboxEvent.create({
          data: outbox(
            "studio-listing",
            updated.id,
            updated.sequence,
            `STUDIO_LISTING_${status}`,
          ),
        });
        await this.audit(
          tx,
          actorId,
          "STUDIO_LISTING_MODERATED",
          status,
          input.decision,
        );
        return this.ownerView(updated);
      },
    );
  }

  async setPreference(
    userId: string,
    draftId: string,
    key: string | undefined,
    input: StudioPreferenceDto,
  ) {
    if (input.mode === "PREFERRED_STUDIO" && !input.studioSlug)
      throw new ConflictException({ code: "STUDIO_REQUIRED" });
    if (input.mode === "AUTO_ASSIGN" && input.studioSlug)
      throw new ConflictException({ code: "STUDIO_NOT_ALLOWED" });
    return this.run(
      `draft:${userId}:${draftId}:studio-preference`,
      key,
      input,
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "OrderDraft" WHERE id = ${draftId}::uuid FOR UPDATE`;
        const draft = await tx.orderDraft.findFirst({
          where: { id: draftId, userId },
          include: { studioPreference: true },
        });
        if (!draft) throw new NotFoundException();
        if (
          draft.version !== input.version ||
          ["CHECKED_OUT", "CANCELLED", "EXPIRED"].includes(draft.status)
        )
          throw new ConflictException({ code: "DRAFT_VERSION_CONFLICT" });
        const listing =
          input.mode === "PREFERRED_STUDIO"
            ? await tx.studioListingVersion.findFirst({
                where: {
                  publicSlug: input.studioSlug,
                  status: "PUBLISHED",
                  branch: {
                    active: true,
                    acceptingOrders: true,
                    partner: { status: { in: ["ACTIVE", "APPROVED"] } },
                    capabilityVersions: {
                      some: {
                        status: "ACTIVE",
                        serviceCodes: { has: draft.serviceCode },
                      },
                    },
                    catalogVersions: {
                      some: {
                        status: "ACTIVE",
                        items: {
                          some: {
                            serviceCode: draft.serviceCode,
                            enabled: true,
                          },
                        },
                      },
                    },
                  },
                },
                include: listingInclude,
              })
            : null;
        const configuration = draft.configuration as Record<string, unknown>;
        const preferenceQuery: StudioQueryDto = {
          serviceCode: draft.serviceCode,
          paperCode:
            typeof configuration.PAPER === "string"
              ? configuration.PAPER
              : undefined,
          colorMode:
            typeof configuration.COLOR === "string"
              ? configuration.COLOR
              : undefined,
        };
        if (
          input.mode === "PREFERRED_STUDIO" &&
          (!listing || !this.compatible(listing, preferenceQuery))
        )
          throw new ConflictException({ code: "STUDIO_NOT_ELIGIBLE" });
        const capability = listing?.branch.capabilityVersions[0];
        const operational = listing?.branch.operationalVersions[0];
        const catalog = listing?.branch.catalogVersions[0];
        const capacity = listing?.branch.capacityVersions[0];
        await tx.orderDraftStudioPreference.upsert({
          where: { draftId },
          create: {
            draftId,
            mode: input.mode,
            fallbackPolicy: input.fallbackPolicy,
            listingId: listing?.id,
            branchId: listing?.branchId,
            capabilityVersionId: capability?.id,
            operationalVersionId: operational?.id,
            catalogVersionId: catalog?.id,
            capacityVersionId: capacity?.id,
          },
          update: {
            mode: input.mode,
            fallbackPolicy: input.fallbackPolicy,
            listingId: listing?.id ?? null,
            branchId: listing?.branchId ?? null,
            capabilityVersionId: capability?.id ?? null,
            operationalVersionId: operational?.id ?? null,
            catalogVersionId: catalog?.id ?? null,
            capacityVersionId: capacity?.id ?? null,
            invalidatedAt: null,
            version: { increment: 1 },
          },
        });
        await tx.priceQuote.updateMany({
          where: { draftId, status: "ACTIVE" },
          data: { status: "STALE" },
        });
        const changed = await tx.orderDraft.updateMany({
          where: { id: draftId, version: input.version },
          data: {
            status: draft.layoutApprovalId ? "READY_FOR_QUOTE" : draft.status,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1)
          throw new ConflictException({ code: "DRAFT_VERSION_CONFLICT" });
        await tx.outboxEvent.create({
          data: outbox(
            "order-draft",
            draftId,
            input.version + 1,
            "DRAFT_STUDIO_PREFERENCE_CHANGED",
          ),
        });
        await this.audit(
          tx,
          userId,
          "DRAFT_STUDIO_PREFERENCE_CHANGED",
          input.mode,
          "UPDATE",
        );
        return {
          mode: input.mode,
          fallbackPolicy: input.fallbackPolicy,
          studio: listing
            ? {
                slug: listing.publicSlug,
                name: draft.locale === "uz" ? listing.titleUz : listing.titleRu,
              }
            : null,
          draftVersion: input.version + 1,
        };
      },
    );
  }

  clearPreference(
    userId: string,
    draftId: string,
    key: string | undefined,
    version: number,
  ) {
    return this.setPreference(userId, draftId, key, {
      version,
      mode: "AUTO_ASSIGN",
      fallbackPolicy: "ALLOW_ELIGIBLE_ALTERNATIVE",
    });
  }

  private compatible(row: ListingRow, query: StudioQueryDto) {
    if (!this.networkConfigured(row)) return false;
    const capability = row.branch.capabilityVersions[0]!;
    const item = row.branch.catalogVersions[0]!.items.find(
      (candidate) => candidate.serviceCode === query.serviceCode,
    );
    if (
      query.serviceCode &&
      (!capability.serviceCodes.includes(query.serviceCode) || !item?.enabled)
    )
      return false;
    if (
      query.paperCode &&
      (!capability.paperCodes.includes(query.paperCode) ||
        (Boolean(item?.paperCodes.length) &&
          !item!.paperCodes.includes(query.paperCode)))
    )
      return false;
    if (
      query.colorMode &&
      (!capability.colorModes.includes(query.colorMode) ||
        (Boolean(item?.colorModes.length) &&
          !item!.colorModes.includes(query.colorMode)))
    )
      return false;
    return true;
  }

  private networkConfigured(row: ListingRow) {
    return (
      [
        row.branch.capabilityVersions[0],
        row.branch.operationalVersions[0],
        row.branch.catalogVersions[0],
        row.branch.capacityVersions[0],
      ].every(Boolean) &&
      ["ACTIVE", "APPROVED"].includes(row.branch.partner.status) &&
      row.branch.active
    );
  }

  private async publicView(
    row: ListingRow,
    locale: "ru" | "uz",
    query: Pick<StudioQueryDto, "latitude" | "longitude">,
  ) {
    const operational = row.branch.operationalVersions[0];
    const now = new Date();
    const unavailable = row.branch.availabilityExceptions.some(
      (item) =>
        !item.cancelledAt &&
        item.kind === "UNAVAILABLE" &&
        item.startsAt <= now &&
        item.endsAt > now,
    );
    const availableOverride = row.branch.availabilityExceptions.some(
      (item) =>
        !item.cancelledAt &&
        item.kind === "AVAILABLE" &&
        item.startsAt <= now &&
        item.endsAt > now,
    );
    const open =
      !unavailable &&
      (availableOverride ||
        Boolean(
          operational &&
            isOpenAt(
              operational.weeklyHours as unknown as WeeklyWindow[],
              now,
              row.branch.timezone,
            ),
        ));
    const services =
      row.branch.catalogVersions[0]?.items
        .filter((item) => item.enabled)
        .map((item) => item.serviceCode) ?? [];
    return {
      slug: row.publicSlug,
      name: locale === "uz" ? row.titleUz : row.titleRu,
      description: locale === "uz" ? row.descriptionUz : row.descriptionRu,
      city: row.branch.city,
      district: row.branch.district,
      openingState: open ? "open" : "closed",
      services,
      distanceBand:
        query.latitude === undefined || query.longitude === undefined
          ? null
          : this.distanceBand(
              await this.maps.distanceMeters(
                { latitude: query.latitude, longitude: query.longitude },
                {
                  latitude: Number(row.branch.latitude),
                  longitude: Number(row.branch.longitude),
                },
              ),
            ),
    };
  }

  private distanceBand(meters: number) {
    return meters < 2_000 ? "near" : meters < 8_000 ? "city" : "far";
  }

  private ownerView(row: {
    id: string;
    sequence: number;
    publicSlug: string;
    status: string;
    titleRu: string;
    titleUz: string;
    descriptionRu: string;
    descriptionUz: string;
  }) {
    return {
      id: row.id,
      version: row.sequence,
      publicSlug: row.publicSlug,
      status: row.status,
      titleRu: row.titleRu,
      titleUz: row.titleUz,
      descriptionRu: row.descriptionRu,
      descriptionUz: row.descriptionUz,
    };
  }
  private copy(input: ListingDraftDto) {
    return {
      publicSlug: input.publicSlug,
      titleRu: input.titleRu,
      titleUz: input.titleUz,
      descriptionRu: input.descriptionRu,
      descriptionUz: input.descriptionUz,
    };
  }
  private audit(
    tx: Prisma.TransactionClient,
    actorId: string,
    eventType: string,
    status: string,
    operation: string,
  ) {
    return tx.auditEvent.create({
      data: {
        actorId,
        eventType,
        targetType: "studio-listing",
        metadata: { status, operation },
      },
    });
  }

  private async run<T extends Prisma.InputJsonObject>(
    scope: string,
    key: string | undefined,
    payload: unknown,
    execute: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    const prepared = this.idempotency.prepare(scope.slice(0, 80), key, payload);
    const replay = await this.idempotency.replay<T>(prepared);
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
          if (prior)
            return this.idempotency.assertCompatible(prior, prepared) as T;
          const response = await execute(tx);
          await tx.idempotencyRecord.create({
            data: this.idempotency.data(prepared, response),
          });
          return response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(error.code)
      ) {
        const replayAfterRace = await this.idempotency.replay<T>(prepared);
        if (replayAfterRace) return replayAfterRace;
        throw new ConflictException({ code: "CONCURRENT_CHANGE" });
      }
      throw error;
    }
  }
}
