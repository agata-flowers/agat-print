import { createHash } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type OrderStatus } from "@prisma/client";
import type { MapsProvider } from "@agat/providers";
import { AuditService } from "../audit/audit.service";
import { IdempotencyService } from "../commerce/idempotency.service";
import type { AppEnvironment } from "../config/environment";
import { PrismaService } from "../prisma/prisma.service";
import {
  APP_ENVIRONMENT,
  PrivateObjectStorageService,
} from "../uploads/private-object-storage.service";
import type {
  CreateCapabilityVersionDto,
  OfferDecisionDto,
  ProductionStatusDto,
} from "./dto";
import {
  activePartnerStatuses,
  comparePreferredCandidateScore,
  evaluateNetworkCandidate,
  isOpenAt,
  type WeeklyWindow,
} from "./network-policy";
import { MAPS_PROVIDER } from "../providers/provider-tokens";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const safeJson = (value: Prisma.JsonValue | null | undefined) =>
  (value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {}) as Record<string, Prisma.JsonValue>;

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
  dedupKey: sha256(
    `${aggregateType}:${aggregateId}:${aggregateVersion}:${eventType}`,
  ),
  payload: { aggregateId, aggregateVersion },
});

const offerInclude = {
  branch: { select: { name: true } },
  payoutSnapshot: true,
} satisfies Prisma.PartnerOfferInclude;

const decisionOfferInclude = {
  order: { include: { studioSelection: { include: { listing: true } } } },
  payoutSnapshot: true,
  branch: { include: { partner: true, availabilityExceptions: true } },
  capabilityVersion: true,
  operationalVersion: true,
  catalogVersion: { include: { items: true } },
  capacityVersion: true,
  capacityReservation: true,
} satisfies Prisma.PartnerOfferInclude;

@Injectable()
export class MatchingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PrivateObjectStorageService)
    private readonly storage: PrivateObjectStorageService,
    @Inject(MAPS_PROVIDER) private readonly maps: MapsProvider,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {}

  async createCapability(
    actorId: string,
    branchId: string,
    input: CreateCapabilityVersionDto,
  ) {
    const capability = await this.prisma.$transaction(
      async (tx) => {
        const branch = await tx.branch.findUnique({ where: { id: branchId } });
        if (!branch) throw new NotFoundException();
        const current = await tx.branchCapabilityVersion.findFirst({
          where: { branchId },
          orderBy: { version: "desc" },
        });
        if (current?.status === "ACTIVE")
          await tx.branchCapabilityVersion.update({
            where: { id: current.id },
            data: { status: "RETIRED", retiredAt: new Date() },
          });
        const created = await tx.branchCapabilityVersion.create({
          data: {
            branchId,
            version: (current?.version ?? 0) + 1,
            supportedFileKinds: input.supportedFileKinds,
            maxPages: input.maxPages,
            maxWidthMm: input.maxWidthMm,
            maxHeightMm: input.maxHeightMm,
            minDpi: input.minDpi,
            priority: input.priority,
            serviceCodes: input.serviceCodes ?? ["DOCUMENT_PRINT"],
            paperCodes: input.paperCodes ?? ["STANDARD"],
            colorModes: input.colorModes ?? ["COLOR", "MONOCHROME"],
            equipmentCodes: input.equipmentCodes ?? [],
            maxQuantity: input.maxQuantity ?? 1000,
            createdById: actorId,
          },
        });
        await tx.outboxEvent.create({
          data: outbox(
            "branch-capability",
            created.id,
            created.version,
            "BRANCH_CAPABILITY_ACTIVATED",
          ),
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.audit.record("BRANCH_CAPABILITY_CREATED", actorId, "branch", {
      status: "ACTIVE",
      operation: "CREATE_VERSION",
    });
    return capability;
  }

  async startByPaymentId(paymentId: string, deliveryDedupKey: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { orderId: true },
    });
    if (!payment) throw new NotFoundException();
    return this.startOrder(payment.orderId, deliveryDedupKey);
  }

  async startOrder(orderId: string, deliveryDedupKey: string) {
    const existing = await this.prisma.inboxOperation.findUnique({
      where: { dedupKey: deliveryDedupKey },
    });
    if (existing) return { duplicate: true };

    let result: { duplicate: boolean; offerCreated?: boolean } | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid FOR UPDATE`;
            const order = await tx.order.findUnique({
              where: { id: orderId },
              include: {
                priceSnapshot: true,
                matching: true,
                layout: { include: { upload: true } },
                studioSelection: true,
              },
            });
            if (!order || !order.priceSnapshot) throw new NotFoundException();
            if (order.status !== "PAID") {
              if (order.matching) return { duplicate: true };
              throw new ConflictException({ code: "ORDER_NOT_PAID" });
            }
            const matching = await tx.orderMatching.create({
              data: { orderId },
            });
            const changed = await tx.order.updateMany({
              where: { id: orderId, version: order.version, status: "PAID" },
              data: { status: "MATCHING", version: { increment: 1 } },
            });
            if (changed.count !== 1)
              throw new ConflictException({ code: "ORDER_VERSION_CONFLICT" });
            const next = await this.createNextOffer(
              tx,
              order,
              matching.version,
              order.version + 1,
            );
            await tx.inboxOperation.create({
              data: {
                dedupKey: deliveryDedupKey,
                operation: "START_MATCHING",
                resultId: next?.id ?? matching.id,
              },
            });
            return { duplicate: false, offerCreated: Boolean(next) };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034";
        if (!retryable || attempt === 2) throw error;
      }
    }
    if (!result) throw new ConflictException({ code: "CONCURRENT_MATCHING" });
    return result;
  }

  async partnerOffers(ownerId: string) {
    const partner = await this.requireApprovedPartner(ownerId);
    const offers = await this.prisma.partnerOffer.findMany({
      where: { partnerId: partner.id },
      include: offerInclude,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return offers.map((offer) => this.partnerOfferView(offer));
  }

  async decideOffer(
    ownerId: string,
    offerId: string,
    key: string | undefined,
    input: OfferDecisionDto,
  ) {
    const partner = await this.requireApprovedPartner(ownerId);
    if (
      !(await this.prisma.partnerOffer.findFirst({
        where: { id: offerId, partnerId: partner.id },
        select: { id: true },
      }))
    )
      throw new NotFoundException();
    const prepared = this.idempotency.prepare(
      `partner-offer:${offerId}`,
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    let result: Record<string, unknown>;
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          const located = await tx.partnerOffer.findFirst({
            where: { id: offerId, partnerId: partner.id },
            select: { orderId: true },
          });
          if (!located) throw new NotFoundException();
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${located.orderId}::uuid FOR UPDATE`;
          const insideReplay = await tx.idempotencyRecord.findUnique({
            where: {
              scope_keyDigest: {
                scope: prepared.scope,
                keyDigest: prepared.keyDigest,
              },
            },
          });
          if (insideReplay)
            return this.idempotency.assertCompatible(
              insideReplay,
              prepared,
            ) as Record<string, unknown>;
          const offer = await tx.partnerOffer.findFirst({
            where: { id: offerId, partnerId: partner.id },
            include: decisionOfferInclude,
          });
          if (!offer) throw new NotFoundException();
          if (offer.status !== "PENDING")
            throw new ConflictException({ code: "OFFER_ALREADY_DECIDED" });
          if (offer.expiresAt.getTime() <= Date.now())
            throw new ConflictException({ code: "OFFER_EXPIRED" });
          const value =
            input.decision === "ACCEPT"
              ? await this.accept(tx, offer)
              : await this.reject(tx, offer);
          if ("conflictCode" in value) return value;
          await tx.idempotencyRecord.create({
            data: this.idempotency.data(
              prepared,
              value as unknown as Prisma.InputJsonValue,
            ),
          });
          return value;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const prismaError =
        error instanceof Prisma.PrismaClientKnownRequestError ? error : null;
      const serializationFailure =
        prismaError?.code === "P2034" ||
        (prismaError?.code === "P2010" &&
          typeof prismaError.meta === "object" &&
          prismaError.meta !== null &&
          "code" in prismaError.meta &&
          prismaError.meta.code === "40001");
      if (prismaError?.code === "P2002" || serializationFailure) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const recovered =
            await this.idempotency.replay<Record<string, unknown>>(prepared);
          if (recovered) return recovered;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        if (serializationFailure)
          throw new ConflictException({ code: "ORDER_VERSION_CONFLICT" });
      }
      throw error;
    }
    if (typeof result.conflictCode === "string")
      throw new ConflictException({ code: result.conflictCode });
    await this.audit.record(
      `PARTNER_OFFER_${input.decision}ED`,
      ownerId,
      "offer",
      {
        status: input.decision === "ACCEPT" ? "ACCEPTED" : "REJECTED",
        operation: input.decision,
      },
    );
    return result;
  }

  async expireOffer(offerId: string, deliveryDedupKey: string) {
    const prior = await this.prisma.inboxOperation.findUnique({
      where: { dedupKey: deliveryDedupKey },
    });
    if (prior) return { duplicate: true };
    return this.prisma.$transaction(
      async (tx) => {
        const offer = await tx.partnerOffer.findUnique({
          where: { id: offerId },
          include: {
            capacityReservation: true,
            order: {
              include: {
                priceSnapshot: true,
                layout: { include: { upload: true } },
                studioSelection: true,
              },
            },
          },
        });
        if (!offer) throw new NotFoundException();
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${offer.orderId}::uuid FOR UPDATE`;
        if (
          offer.status === "PENDING" &&
          offer.expiresAt.getTime() <= Date.now()
        ) {
          await tx.partnerOffer.update({
            where: { id: offer.id },
            data: {
              status: "EXPIRED",
              decidedAt: new Date(),
              version: { increment: 1 },
            },
          });
          if (offer.capacityReservation?.status === "HELD")
            await tx.offerCapacityReservation.update({
              where: { id: offer.capacityReservation.id },
              data: { status: "RELEASED", releasedAt: new Date() },
            });
          await this.createNextOffer(tx, offer.order, 0);
        }
        await tx.inboxOperation.create({
          data: {
            dedupKey: deliveryDedupKey,
            operation: "EXPIRE_PARTNER_OFFER",
            resultId: offer.id,
          },
        });
        return { duplicate: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async activeOrder(ownerId: string) {
    const partner = await this.requireApprovedPartner(ownerId);
    const assignment = await this.prisma.partnerAssignment.findFirst({
      where: {
        partnerId: partner.id,
        order: {
          status: {
            in: [
              "PARTNER_ACCEPTED",
              "IN_PRODUCTION",
              "READY",
              "AWAITING_PICKUP",
              "COURIER_ASSIGNED",
              "IN_DELIVERY",
              "REPRINT",
            ],
          },
        },
      },
      include: {
        order: {
          include: {
            fulfillments: { orderBy: { createdAt: "desc" }, take: 1 },
            deliveryTasks: { orderBy: { assignedAt: "desc" }, take: 1 },
          },
        },
        branch: { select: { name: true } },
      },
      orderBy: { acceptedAt: "asc" },
    });
    if (!assignment) return null;
    return {
      orderId: assignment.orderId,
      status: assignment.order.status,
      branchName: assignment.branch.name,
      acceptedAt: assignment.acceptedAt,
      fulfillmentMode: assignment.order.fulfillments[0]?.mode ?? null,
      deliveryId: assignment.order.deliveryTasks[0]?.id ?? null,
    };
  }

  async printReadyUrl(
    ownerId: string,
    orderId: string,
    key: string | undefined,
  ) {
    const partner = await this.requireApprovedPartner(ownerId);
    const prepared = this.idempotency.prepare(
      `download:${createHash("sha256").update(`${ownerId}:${orderId}`).digest("hex")}`,
      key,
      {},
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    const assignment = await this.prisma.partnerAssignment.findFirst({
      where: { orderId, partnerId: partner.id },
      include: { order: { include: { printReadyVersion: true } } },
    });
    if (
      !assignment ||
      !["PARTNER_ACCEPTED", "REPRINT", "IN_PRODUCTION", "READY"].includes(
        assignment.order.status,
      )
    )
      throw new ForbiddenException({ code: "PRINT_READY_FORBIDDEN" });
    const value = {
      url: await this.storage.signedGetUrl(
        assignment.order.printReadyVersion.objectKey,
        this.env.previewSignedUrlTtlSeconds,
      ),
      expiresInSeconds: this.env.previewSignedUrlTtlSeconds,
    };
    if (!replay)
      await this.prisma.idempotencyRecord.upsert({
        where: {
          scope_keyDigest: {
            scope: prepared.scope,
            keyDigest: prepared.keyDigest,
          },
        },
        create: this.idempotency.data(prepared, { authorized: true }),
        update: {},
      });
    await this.audit.record(
      "PARTNER_PRINT_READY_DOWNLOADED",
      ownerId,
      "order",
      {
        status: assignment.order.status,
        operation: "DOWNLOAD",
      },
    );
    return value;
  }

  async setProductionStatus(
    ownerId: string,
    orderId: string,
    key: string | undefined,
    input: ProductionStatusDto,
  ) {
    const partner = await this.requireApprovedPartner(ownerId);
    const cycle = await this.prisma.productionCycle.findFirst({
      where: { orderId, assignment: { partnerId: partner.id } },
      orderBy: { sequence: "desc" },
    });
    if (!cycle) throw new ForbiddenException();
    const prepared = this.idempotency.prepare(
      `partner-status:${cycle.id}`,
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const value = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid FOR UPDATE`;
        const latest = await tx.productionCycle.findFirst({
          where: { orderId },
          orderBy: { sequence: "desc" },
        });
        if (latest?.id !== cycle.id)
          throw new ConflictException({ code: "STALE_PRODUCTION_CYCLE" });
        const insideReplay = await tx.idempotencyRecord.findUnique({
          where: {
            scope_keyDigest: {
              scope: prepared.scope,
              keyDigest: prepared.keyDigest,
            },
          },
        });
        if (insideReplay)
          return this.idempotency.assertCompatible(
            insideReplay,
            prepared,
          ) as Record<string, unknown>;
        const assignment = await tx.partnerAssignment.findFirst({
          where: { orderId, partnerId: partner.id, active: true },
          include: {
            order: {
              include: {
                printJobs: { orderBy: { createdAt: "desc" }, take: 1 },
              },
            },
          },
        });
        if (!assignment) throw new ForbiddenException();
        if (
          assignment.order.printJobs[0] &&
          ["LEASED", "PRINTING"].includes(assignment.order.printJobs[0].status)
        )
          throw new ConflictException({ code: "PRINTER_AGENT_ACTIVE" });
        const expected: OrderStatus[] =
          input.status === "IN_PRODUCTION"
            ? ["PARTNER_ACCEPTED", "REPRINT"]
            : ["IN_PRODUCTION"];
        if (!expected.includes(assignment.order.status))
          throw new ConflictException({
            code: "INVALID_PRODUCTION_TRANSITION",
          });
        const changed = await tx.order.updateMany({
          where: {
            id: orderId,
            version: assignment.order.version,
            status: { in: expected },
          },
          data: { status: input.status, version: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw new ConflictException({ code: "ORDER_VERSION_CONFLICT" });
        if (
          input.status === "IN_PRODUCTION" &&
          assignment.order.printJobs[0]?.status === "PENDING"
        )
          await tx.printJob.update({
            where: { id: assignment.order.printJobs[0].id },
            data: { status: "CANCELLED", version: { increment: 1 } },
          });
        if (input.status === "READY")
          await tx.partnerAssignment.update({
            where: { id: assignment.id },
            data: {
              status: "READY",
              active: false,
              readyAt: new Date(),
              version: { increment: 1 },
            },
          });
        const currentCycle = await tx.productionCycle.findFirst({
          where: { orderId },
          orderBy: { sequence: "desc" },
        });
        if (currentCycle)
          await tx.productionCycle.update({
            where: { id: currentCycle.id },
            data: {
              status: input.status === "READY" ? "READY" : "IN_PRODUCTION",
              version: { increment: 1 },
            },
          });
        const response = { orderId, status: input.status };
        await tx.idempotencyRecord.create({
          data: this.idempotency.data(
            prepared,
            response as Prisma.InputJsonValue,
          ),
        });
        await tx.outboxEvent.create({
          data: outbox(
            "order",
            orderId,
            assignment.order.version + 1,
            `ORDER_${input.status}`,
          ),
        });
        return response;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.audit.record("PRODUCTION_STATUS_CHANGED", ownerId, "order", {
      status: input.status,
      operation: "MANUAL",
    });
    return value;
  }

  async adminHistory() {
    const orders = await this.prisma.order.findMany({
      where: { matching: { isNot: null } },
      include: {
        matching: {
          include: {
            evaluations: {
              orderBy: [{ evaluationRound: "desc" }, { candidateRank: "asc" }],
            },
          },
        },
        partnerOffers: {
          include: { payoutSnapshot: true },
          orderBy: { candidateRank: "asc" },
        },
        assignments: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return orders.map((order) => ({
      orderId: order.id,
      orderStatus: order.status,
      matchingStatus: order.matching?.status,
      offers: order.partnerOffers.map((offer) => ({
        id: offer.id,
        status: offer.status,
        candidateRank: offer.candidateRank,
        expiresAt: offer.expiresAt,
        payout: offer.payoutSnapshot
          ? {
              currency: offer.payoutSnapshot.currency,
              partnerPayoutMinor:
                offer.payoutSnapshot.partnerPayoutMinor.toString(),
              commissionMinor:
                offer.payoutSnapshot.agatCommissionMinor.toString(),
              ruleVersion: offer.payoutSnapshot.ruleVersion,
            }
          : null,
      })),
      assignmentStatus: order.assignments[0]?.status ?? null,
      evaluations:
        order.matching?.evaluations.map((evaluation) => ({
          reasonCodes: evaluation.reasonCodes,
          eligible: evaluation.eligible,
          candidateRank: evaluation.candidateRank,
          priority: evaluation.priority,
          distanceMeters: evaluation.distanceMeters,
          workloadBasisPoints: evaluation.workloadBasisPoints,
          evaluationRound: evaluation.evaluationRound,
        })) ?? [],
    }));
  }

  private async requireApprovedPartner(ownerId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { ownerId },
    });
    if (
      !partner ||
      !["APPROVED", "ACTIVE", "SUSPENDED"].includes(partner.status)
    )
      throw new ForbiddenException();
    return partner;
  }

  private async accept(
    tx: Prisma.TransactionClient,
    offer: Prisma.PartnerOfferGetPayload<{
      include: typeof decisionOfferInclude;
    }>,
  ) {
    if (!offer.payoutSnapshot)
      throw new ConflictException({ code: "PAYOUT_SNAPSHOT_MISSING" });
    if (
      offer.order.studioSelection?.mode === "PREFERRED_STUDIO" &&
      offer.order.studioSelection.branchId === offer.branchId &&
      offer.order.studioSelection.listing?.status !== "PUBLISHED"
    )
      return this.invalidateOffer(tx, offer, "PREFERRED_STUDIO_RETIRED");
    if (
      !activePartnerStatuses.includes(offer.branch.partner.status) ||
      !offer.branch.active ||
      !offer.branch.acceptingOrders
    )
      return this.invalidateOffer(tx, offer, "OFFER_NO_LONGER_ELIGIBLE");
    if (offer.capacityReservation) {
      if (
        offer.capacityReservation.status !== "HELD" ||
        offer.capacityReservation.expiresAt <= new Date()
      )
        return this.invalidateOffer(tx, offer, "CAPACITY_RESERVATION_EXPIRED");
      const [capability, operational, catalog, capacity] = await Promise.all([
        tx.branchCapabilityVersion.findFirst({
          where: { branchId: offer.branchId, status: "ACTIVE" },
          orderBy: { version: "desc" },
        }),
        tx.branchOperationalVersion.findFirst({
          where: { branchId: offer.branchId, status: "ACTIVE" },
          orderBy: { version: "desc" },
        }),
        tx.branchCatalogVersion.findFirst({
          where: { branchId: offer.branchId, status: "ACTIVE" },
          orderBy: { version: "desc" },
        }),
        tx.branchCapacityVersion.findFirst({
          where: { branchId: offer.branchId, status: "ACTIVE" },
          orderBy: { version: "desc" },
        }),
      ]);
      if (
        capability?.id !== offer.capabilityVersionId ||
        operational?.id !== offer.operationalVersionId ||
        catalog?.id !== offer.catalogVersionId ||
        capacity?.id !== offer.capacityVersionId
      )
        return this.invalidateOffer(tx, offer, "STALE_NETWORK_VERSION");
      const now = new Date();
      const exceptions = offer.branch.availabilityExceptions.filter(
        (item) =>
          !item.cancelledAt && item.startsAt <= now && item.endsAt > now,
      );
      if (exceptions.some((item) => item.kind === "UNAVAILABLE"))
        return this.invalidateOffer(tx, offer, "PARTNER_UNAVAILABLE");
      if (
        !exceptions.some((item) => item.kind === "AVAILABLE") &&
        offer.operationalVersion &&
        !isOpenAt(
          offer.operationalVersion.weeklyHours as unknown as WeeklyWindow[],
          now,
          offer.branch.timezone,
        )
      )
        return this.invalidateOffer(tx, offer, "PARTNER_UNAVAILABLE");
      await tx.offerCapacityReservation.update({
        where: { id: offer.capacityReservation.id },
        data: { status: "CONSUMED", consumedAt: now },
      });
    }
    const changed = await tx.order.updateMany({
      where: {
        id: offer.orderId,
        version: offer.order.version,
        status: "PARTNER_OFFERED",
      },
      data: { status: "PARTNER_ACCEPTED", version: { increment: 1 } },
    });
    if (changed.count !== 1)
      throw new ConflictException({ code: "ORDER_VERSION_CONFLICT" });
    await tx.partnerOffer.update({
      where: { id: offer.id },
      data: {
        status: "ACCEPTED",
        decidedAt: new Date(),
        version: { increment: 1 },
      },
    });
    const assignment = await tx.partnerAssignment.create({
      data: {
        orderId: offer.orderId,
        offerId: offer.id,
        partnerId: offer.partnerId,
        branchId: offer.branchId,
        payoutSnapshotId: offer.payoutSnapshot.id,
      },
    });
    await tx.productionCycle.create({
      data: {
        orderId: offer.orderId,
        sequence: 1,
        kind: "ORIGINAL",
        assignmentId: assignment.id,
        printReadyVersionId: offer.order.printReadyVersionId,
      },
    });
    await tx.orderMatching.update({
      where: { orderId: offer.orderId },
      data: {
        status: "ASSIGNED",
        assignedAt: new Date(),
        version: { increment: 1 },
      },
    });
    await tx.outboxEvent.create({
      data: outbox(
        "order",
        offer.orderId,
        offer.order.version + 1,
        "PARTNER_ASSIGNED",
      ),
    });
    return {
      orderId: offer.orderId,
      offerStatus: "ACCEPTED",
      orderStatus: "PARTNER_ACCEPTED",
      assignmentId: assignment.id,
    };
  }

  private async reject(
    tx: Prisma.TransactionClient,
    offer: Prisma.PartnerOfferGetPayload<{
      include: typeof decisionOfferInclude;
    }>,
  ) {
    await tx.partnerOffer.update({
      where: { id: offer.id },
      data: {
        status: "REJECTED",
        decidedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (offer.capacityReservation?.status === "HELD")
      await tx.offerCapacityReservation.update({
        where: { id: offer.capacityReservation.id },
        data: { status: "RELEASED", releasedAt: new Date() },
      });
    const fullOrder = await tx.order.findUniqueOrThrow({
      where: { id: offer.orderId },
      include: {
        priceSnapshot: true,
        layout: { include: { upload: true } },
        studioSelection: true,
      },
    });
    const next = await this.createNextOffer(tx, fullOrder, 0);
    return {
      orderId: offer.orderId,
      offerStatus: "REJECTED",
      nextOfferCreated: Boolean(next),
    };
  }

  private async invalidateOffer(
    tx: Prisma.TransactionClient,
    offer: Prisma.PartnerOfferGetPayload<{
      include: typeof decisionOfferInclude;
    }>,
    conflictCode: string,
  ) {
    await tx.partnerOffer.update({
      where: { id: offer.id },
      data: {
        status: "EXPIRED",
        decidedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (offer.capacityReservation?.status === "HELD")
      await tx.offerCapacityReservation.update({
        where: { id: offer.capacityReservation.id },
        data: { status: "RELEASED", releasedAt: new Date() },
      });
    const fullOrder = await tx.order.findUniqueOrThrow({
      where: { id: offer.orderId },
      include: {
        priceSnapshot: true,
        layout: { include: { upload: true } },
        studioSelection: true,
      },
    });
    await this.createNextOffer(tx, fullOrder, 0);
    return { conflictCode };
  }

  private async createNextOffer(
    tx: Prisma.TransactionClient,
    order: Prisma.OrderGetPayload<{
      include: {
        priceSnapshot: true;
        layout: { include: { upload: true } };
        studioSelection: true;
      };
    }>,
    matchingVersion: number,
    expectedOrderVersion = order.version,
  ) {
    if (!order.priceSnapshot)
      throw new ConflictException({ code: "PRICE_SNAPSHOT_MISSING" });
    const settings = safeJson(order.layout.settings);
    const width = Number(settings.targetWidthMm ?? 0);
    const height = Number(settings.targetHeightMm ?? 0);
    const dpi = Number(settings.minDpi ?? 72);
    const serviceCode =
      typeof settings.serviceCode === "string"
        ? settings.serviceCode
        : "DOCUMENT_PRINT";
    const paperCode =
      typeof settings.paperCode === "string" ? settings.paperCode : "STANDARD";
    const colorMode =
      typeof settings.colorMode === "string" ? settings.colorMode : "COLOR";
    const requiredEquipment = Array.isArray(settings.equipmentCodes)
      ? settings.equipmentCodes.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    const quantity = order.priceSnapshot.quantity;
    const pageCount = Number(
      safeJson(order.priceSnapshot.sourceParameters).pageCount ?? 0,
    );
    const demandLocation = {
      latitude: Number(settings.latitude ?? 41.311081),
      longitude: Number(settings.longitude ?? 69.240562),
    };
    const excluded = await tx.partnerOffer.findMany({
      where: { orderId: order.id },
      select: { branchId: true },
    });
    const now = new Date();
    const preferredBranchId =
      order.studioSelection?.mode === "PREFERRED_STUDIO"
        ? order.studioSelection.branchId
        : null;
    const strictPreference =
      order.studioSelection?.mode === "PREFERRED_STUDIO" &&
      order.studioSelection.fallbackPolicy === "STRICT_PREFERENCE";
    const branches = await tx.branch.findMany({
      where: {
        id: { notIn: excluded.map((item) => item.branchId) },
      },
      include: {
        partner: true,
        capabilityVersions: {
          where: { status: "ACTIVE" },
          orderBy: { version: "desc" },
          take: 1,
        },
        operationalVersions: {
          where: { status: "ACTIVE" },
          orderBy: { version: "desc" },
          take: 1,
        },
        catalogVersions: {
          where: { status: "ACTIVE" },
          orderBy: { version: "desc" },
          take: 1,
          include: { items: true },
        },
        capacityVersions: {
          where: { status: "ACTIVE" },
          orderBy: { version: "desc" },
          take: 1,
        },
        availabilityExceptions: {
          where: {
            cancelledAt: null,
            startsAt: { lte: now },
            endsAt: { gt: now },
          },
        },
        _count: {
          select: {
            assignments: { where: { active: true } },
            capacityReservations: {
              where: { status: "HELD", expiresAt: { gt: now } },
            },
          },
        },
      },
    });
    const matching = await tx.orderMatching.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    const latestRound = await tx.matchingCandidateEvaluation.aggregate({
      where: { matchingId: matching.id },
      _max: { evaluationRound: true },
    });
    const evaluationRound = (latestRound._max.evaluationRound ?? -1) + 1;
    const evaluated = await Promise.all(
      branches.map(async (branch) => {
        const capability = branch.capabilityVersions[0] ?? null;
        const operational = branch.operationalVersions[0] ?? null;
        const catalog = branch.catalogVersions[0] ?? null;
        const capacity = branch.capacityVersions[0] ?? null;
        const catalogItem = catalog?.items.find(
          (item) => item.serviceCode === serviceCode,
        );
        const compatible = Boolean(
          capability &&
            capability.supportedFileKinds.includes(
              order.layout.upload.fileKind,
            ) &&
            capability.maxPages >= pageCount &&
            capability.maxWidthMm >= width &&
            capability.maxHeightMm >= height &&
            capability.minDpi <= dpi &&
            capability.serviceCodes.includes(serviceCode) &&
            capability.paperCodes.includes(paperCode) &&
            capability.colorModes.includes(colorMode) &&
            capability.maxQuantity >= quantity &&
            requiredEquipment.every((item) =>
              capability.equipmentCodes.includes(item),
            ),
        );
        const serviceEnabled = catalog
          ? Boolean(
              catalogItem?.enabled &&
                catalogItem.maxQuantity >= quantity &&
                (catalogItem.paperCodes.length === 0 ||
                  catalogItem.paperCodes.includes(paperCode)) &&
                (catalogItem.colorModes.length === 0 ||
                  catalogItem.colorModes.includes(colorMode)),
            )
          : true;
        const weeklyHours = Array.isArray(operational?.weeklyHours)
          ? (operational.weeklyHours as unknown as WeeklyWindow[])
          : [];
        const withinHours = operational
          ? isOpenAt(weeklyHours, now, branch.timezone)
          : true;
        const availability = branch.availabilityExceptions.some(
          (item) => item.kind === "UNAVAILABLE",
        )
          ? "UNAVAILABLE"
          : branch.availabilityExceptions.some(
                (item) => item.kind === "AVAILABLE",
              )
            ? "AVAILABLE"
            : "DEFAULT";
        const branchLocation = {
          latitude: Number(branch.latitude),
          longitude: Number(branch.longitude),
        };
        const distance = await this.maps.distanceMeters(
          demandLocation,
          branchLocation,
        );
        const capacityLimit = capacity?.maxConcurrentOrders ?? 1000;
        const workload =
          branch._count.assignments + branch._count.capacityReservations;
        const reasons = evaluateNetworkCandidate({
          partnerStatus: branch.partner.status,
          branchActive: branch.active,
          acceptingOrders: branch.acceptingOrders,
          capabilityCompatible: compatible,
          serviceEnabled,
          withinHours,
          availability,
          withinServiceArea: distance <= branch.serviceRadiusMeters,
          workload,
          capacity: capacityLimit,
        });
        return {
          branchId: branch.id,
          branch,
          capability,
          operational,
          catalog,
          capacity,
          reasons,
          priority: capability?.priority ?? 1000,
          distanceMeters: distance,
          workloadBasisPoints: Math.floor((workload * 10_000) / capacityLimit),
          preferred: branch.id === preferredBranchId,
        };
      }),
    );
    for (const candidate of evaluated) {
      if (candidate.preferred && candidate.reasons[0] === "ELIGIBLE")
        candidate.reasons.push("CUSTOMER_PREFERRED");
    }
    const eligible = evaluated
      .filter((candidate) => candidate.reasons[0] === "ELIGIBLE")
      .sort((left, right) => comparePreferredCandidateScore(left, right));
    let selected = strictPreference
      ? (eligible.find((candidate) => candidate.preferred) ?? null)
      : (eligible[0] ?? null);
    while (selected?.capacity) {
      await tx.$queryRaw`SELECT id FROM "BranchCapacityVersion" WHERE id = ${selected.capacity.id}::uuid FOR UPDATE`;
      const [assignments, reservations] = await Promise.all([
        tx.partnerAssignment.count({
          where: { branchId: selected.branch.id, active: true },
        }),
        tx.offerCapacityReservation.count({
          where: {
            branchId: selected.branch.id,
            status: "HELD",
            expiresAt: { gt: now },
          },
        }),
      ]);
      if (assignments + reservations < selected.capacity.maxConcurrentOrders)
        break;
      selected.reasons = ["CAPACITY_FULL"];
      selected = strictPreference
        ? null
        : (eligible.find(
            (candidate) =>
              candidate !== selected && candidate.reasons[0] === "ELIGIBLE",
          ) ?? null);
    }
    const ranked = evaluated
      .filter((candidate) => candidate.reasons[0] === "ELIGIBLE")
      .sort((left, right) => comparePreferredCandidateScore(left, right));
    const evaluationIds = new Map<string, string>();
    for (const candidate of evaluated) {
      const rank = ranked.findIndex(
        (item) => item.branch.id === candidate.branch.id,
      );
      const record = await tx.matchingCandidateEvaluation.create({
        data: {
          matchingId: matching.id,
          branchId: candidate.branch.id,
          evaluationRound,
          capabilityVersionId: candidate.capability?.id,
          operationalVersionId: candidate.operational?.id,
          catalogVersionId: candidate.catalog?.id,
          capacityVersionId: candidate.capacity?.id,
          reasonCodes: candidate.reasons,
          eligible: candidate.reasons[0] === "ELIGIBLE",
          candidateRank: rank >= 0 ? rank + 1 : null,
          priority: candidate.capability?.priority,
          distanceMeters: candidate.distanceMeters,
          workloadBasisPoints: candidate.workloadBasisPoints,
        },
      });
      evaluationIds.set(candidate.branch.id, record.id);
    }
    if (!selected) {
      const matching = await tx.orderMatching.update({
        where: { orderId: order.id },
        data: {
          status: "EXHAUSTED",
          exhaustedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await tx.outboxEvent.create({
        data: outbox("order", order.id, matching.version, "MATCHING_EXHAUSTED"),
      });
      return null;
    }
    const payout =
      (order.priceSnapshot.totalMinor *
        BigInt(this.env.partnerPayoutBasisPoints)) /
      10_000n;
    const offer = await tx.partnerOffer.create({
      data: {
        orderId: order.id,
        partnerId: selected.branch.partnerId,
        branchId: selected.branch.id,
        capabilityVersionId: selected.capability!.id,
        operationalVersionId: selected.operational?.id,
        catalogVersionId: selected.catalog?.id,
        capacityVersionId: selected.capacity?.id,
        evaluationId: evaluationIds.get(selected.branch.id),
        candidateRank: excluded.length + 1,
        expiresAt: new Date(
          Date.now() + this.env.partnerOfferTtlSeconds * 1000,
        ),
        payoutSnapshot: {
          create: {
            customerAmountMinor: order.priceSnapshot.totalMinor,
            partnerPayoutMinor: payout,
            agatCommissionMinor: order.priceSnapshot.totalMinor - payout,
            currency: "UZS",
            ruleVersion: this.env.partnerPayoutRuleVersion,
            calculationInputs: {
              payoutBasisPoints: this.env.partnerPayoutBasisPoints,
              tariffVersion: order.priceSnapshot.tariffVersion,
              capabilityVersion: selected.capability!.version,
              catalogVersion: selected.catalog?.version ?? 0,
              capacityVersion: selected.capacity?.version ?? 0,
              quantity: order.priceSnapshot.quantity,
            },
          },
        },
        capacityReservation: selected.capacity
          ? {
              create: {
                branchId: selected.branch.id,
                capacityVersionId: selected.capacity.id,
                expiresAt: new Date(
                  Date.now() + this.env.partnerOfferTtlSeconds * 1000,
                ),
              },
            }
          : undefined,
      },
      include: offerInclude,
    });
    const changed = await tx.order.updateMany({
      where: { id: order.id, version: expectedOrderVersion },
      data: { status: "PARTNER_OFFERED", version: { increment: 1 } },
    });
    if (changed.count !== 1)
      throw new ConflictException({ code: "ORDER_VERSION_CONFLICT" });
    await tx.outboxEvent.create({
      data: outbox(
        "partner-offer",
        offer.id,
        matchingVersion + offer.candidateRank,
        "PARTNER_OFFER_CREATED",
      ),
    });
    return offer;
  }

  private partnerOfferView(
    offer: Prisma.PartnerOfferGetPayload<{ include: typeof offerInclude }>,
  ) {
    return {
      id: offer.id,
      orderId: offer.orderId,
      branchName: offer.branch.name,
      status: offer.status,
      expiresAt: offer.expiresAt,
      payout: offer.payoutSnapshot
        ? {
            amountMinor: offer.payoutSnapshot.partnerPayoutMinor.toString(),
            currency: offer.payoutSnapshot.currency,
            ruleVersion: offer.payoutSnapshot.ruleVersion,
          }
        : null,
    };
  }
}
