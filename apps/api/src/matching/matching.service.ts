import { createHash } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type OrderStatus } from "@prisma/client";
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
import { MockMapsProvider } from "./mock-maps.provider";

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

@Injectable()
export class MatchingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PrivateObjectStorageService)
    private readonly storage: PrivateObjectStorageService,
    @Inject(MockMapsProvider) private readonly maps: MockMapsProvider,
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

    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid FOR UPDATE`;
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            priceSnapshot: true,
            matching: true,
            layout: { include: { upload: true } },
          },
        });
        if (!order || !order.priceSnapshot) throw new NotFoundException();
        if (order.status !== "PAID") {
          if (order.matching) return { duplicate: true };
          throw new ConflictException({ code: "ORDER_NOT_PAID" });
        }
        const matching = await tx.orderMatching.create({ data: { orderId } });
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
            include: { order: true, payoutSnapshot: true },
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
            order: {
              include: {
                priceSnapshot: true,
                layout: { include: { upload: true } },
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
        matching: true,
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
    }));
  }

  private async requireApprovedPartner(ownerId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { ownerId },
    });
    if (!partner || partner.status !== "APPROVED")
      throw new ForbiddenException();
    return partner;
  }

  private async accept(
    tx: Prisma.TransactionClient,
    offer: Prisma.PartnerOfferGetPayload<{
      include: { order: true; payoutSnapshot: true };
    }>,
  ) {
    if (!offer.payoutSnapshot)
      throw new ConflictException({ code: "PAYOUT_SNAPSHOT_MISSING" });
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
      include: { order: true; payoutSnapshot: true };
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
    const fullOrder = await tx.order.findUniqueOrThrow({
      where: { id: offer.orderId },
      include: { priceSnapshot: true, layout: { include: { upload: true } } },
    });
    const next = await this.createNextOffer(tx, fullOrder, 0);
    return {
      orderId: offer.orderId,
      offerStatus: "REJECTED",
      nextOfferCreated: Boolean(next),
    };
  }

  private async createNextOffer(
    tx: Prisma.TransactionClient,
    order: Prisma.OrderGetPayload<{
      include: { priceSnapshot: true; layout: { include: { upload: true } } };
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
    const pageCount = Number(
      safeJson(order.priceSnapshot.sourceParameters).pageCount ?? 0,
    );
    const excluded = await tx.partnerOffer.findMany({
      where: { orderId: order.id },
      select: { branchId: true },
    });
    const candidates = await tx.branchCapabilityVersion.findMany({
      where: {
        status: "ACTIVE",
        branch: { active: true, partner: { status: "APPROVED" } },
        supportedFileKinds: { has: order.layout.upload.fileKind },
        maxPages: { gte: pageCount },
        maxWidthMm: { gte: width },
        maxHeightMm: { gte: height },
        minDpi: { lte: dpi },
        branchId: { notIn: excluded.map((item) => item.branchId) },
      },
      include: { branch: { include: { partner: true } } },
    });
    const scored = await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        distance: await this.maps.distanceScore(
          "TASHKENT",
          candidate.branch.locationCode,
        ),
      })),
    );
    scored.sort(
      (left, right) =>
        left.candidate.priority - right.candidate.priority ||
        left.distance - right.distance ||
        left.candidate.branchId.localeCompare(right.candidate.branchId),
    );
    const selected = scored[0]?.candidate;
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
        branchId: selected.branchId,
        capabilityVersionId: selected.id,
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
              capabilityVersion: selected.version,
              quantity: order.priceSnapshot.quantity,
            },
          },
        },
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
