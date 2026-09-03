import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type OrderStatus } from "@prisma/client";
import { IdempotencyService } from "../commerce/idempotency.service";
import { PrismaService } from "../prisma/prisma.service";
import type {
  CreateLegalHoldDto,
  OpenDisputeDto,
  PartnerDisputeResponseDto,
  ResolveDisputeDto,
} from "./dto";
import {
  activeDisputes,
  assertDisputeWindow,
  digest,
  event,
  protectObjects,
  refundAmount,
  retentionLock,
} from "./domain";

@Injectable()
export class DisputesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  private async command(
    actorId: string,
    orderId: string,
    operation: string,
    key: string | undefined,
    input: unknown,
    execute: (tx: Prisma.TransactionClient) => Promise<Prisma.InputJsonObject>,
  ) {
    const prepared = this.idempotency.prepare(
      "aftercare:" + digest(actorId + ":" + orderId + ":" + operation),
      key,
      input,
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await retentionLock(tx);
            await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid FOR UPDATE`;
            const prior = await tx.idempotencyRecord.findUnique({
              where: {
                scope_keyDigest: {
                  scope: prepared.scope,
                  keyDigest: prepared.keyDigest,
                },
              },
            });
            if (prior)
              return this.idempotency.assertCompatible(prior, prepared);
            const result = await execute(tx);
            await tx.idempotencyRecord.create({
              data: this.idempotency.data(prepared, result, 201),
            });
            await tx.auditEvent.create({
              data: {
                actorId,
                eventType: "AFTERCARE_COMMAND",
                targetType: "order",
                metadata: { operation, result: "COMMITTED" },
              },
            });
            return result;
          },
          { timeout: 15000 },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ["P2002", "P2034"].includes(error.code)
        ) {
          const replay =
            await this.idempotency.replay<Prisma.JsonValue>(prepared);
          if (replay !== undefined) return replay;
          if (error.code === "P2034" && attempt < 2) continue;
          throw new ConflictException({ code: "CONCURRENT_OPERATION" });
        }
        throw error;
      }
    }
    throw new ConflictException({ code: "CONCURRENT_OPERATION" });
  }

  async open(
    userId: string,
    orderId: string,
    key: string | undefined,
    input: OpenDisputeDto,
  ) {
    await this.requireOwned(userId, orderId);
    return this.command(
      userId,
      orderId,
      "OPEN_DISPUTE",
      key,
      input,
      async (tx) => {
        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: { disputes: true },
        });
        if (!["COMPLETED", "DELIVERY_FAILED"].includes(order.status))
          throw new ConflictException({ code: "DISPUTE_NOT_ELIGIBLE" });
        const expiresAt = assertDisputeWindow(order.disputeEligibleAt);
        if (
          order.disputes.some(
            (x) => x.status === "OPEN" || x.status === "PARTNER_RESPONDED",
          )
        )
          throw new ConflictException({ code: "ACTIVE_DISPUTE_EXISTS" });
        const dispute = await tx.disputeCase.create({
          data: {
            orderId,
            sequence: Math.max(0, ...order.disputes.map((x) => x.sequence)) + 1,
            openedById: userId,
            category: input.category,
            structuredComment: input.structuredComment?.trim() || null,
            openedFromStatus: order.status,
            expiresAt,
          },
        });
        await this.transition(
          tx,
          orderId,
          order.version,
          order.status,
          "DISPUTED",
        );
        await tx.legalHold.create({
          data: {
            orderId,
            disputeId: dispute.id,
            reasonCode: "OPEN_DISPUTE",
            createdById: userId,
          },
        });
        await protectObjects(tx, orderId);
        await tx.outboxEvent.create({
          data: event("dispute", dispute.id, 0, "DISPUTE_OPENED"),
        });
        return {
          disputeId: dispute.id,
          status: "OPEN",
          orderStatus: "DISPUTED",
          expiresAt: expiresAt.toISOString(),
        };
      },
    );
  }

  async own(userId: string, orderId: string) {
    await this.requireOwned(userId, orderId);
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        disputes: {
          orderBy: { sequence: "desc" },
          include: { resolution: true, responses: true },
        },
      },
    });
    return {
      orderId,
      orderStatus: order.status,
      disputes: order.disputes.map((x) => ({
        id: x.id,
        category: x.category,
        status: x.status,
        structuredComment: x.structuredComment,
        createdAt: x.createdAt,
        partnerResponse: x.responses[0]?.responseCode ?? null,
        resolution: x.resolution
          ? {
              type: x.resolution.type,
              refundAmountMinor:
                x.resolution.refundAmountMinor?.toString() ?? null,
              currency: x.resolution.currency,
            }
          : null,
      })),
    };
  }

  async cancel(userId: string, disputeId: string, key: string | undefined) {
    const located = await this.prisma.disputeCase.findFirst({
      where: { id: disputeId, openedById: userId },
    });
    if (!located) throw new NotFoundException();
    return this.command(
      userId,
      located.orderId,
      "CANCEL_DISPUTE",
      key,
      { disputeId },
      async (tx) => {
        const dispute = await tx.disputeCase.findUniqueOrThrow({
          where: { id: disputeId },
          include: { order: true },
        });
        if (dispute.status !== "OPEN" || dispute.order.status !== "DISPUTED")
          throw new ConflictException({ code: "DISPUTE_CANNOT_CANCEL" });
        await tx.disputeCase.update({
          where: { id: disputeId, version: dispute.version, status: "OPEN" },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            version: { increment: 1 },
          },
        });
        await this.transition(
          tx,
          dispute.orderId,
          dispute.order.version,
          "DISPUTED",
          dispute.openedFromStatus,
        );
        await tx.legalHold.updateMany({
          where: { disputeId, releasedAt: null },
          data: { releasedAt: new Date(), releasedById: userId },
        });
        await tx.outboxEvent.create({
          data: event(
            "dispute",
            disputeId,
            dispute.version + 1,
            "DISPUTE_CANCELLED",
          ),
        });
        return {
          disputeId,
          status: "CANCELLED",
          orderStatus: dispute.openedFromStatus,
        };
      },
    );
  }

  async partnerList(ownerId: string) {
    const partner = await this.requirePartner(ownerId);
    return this.prisma.disputeCase.findMany({
      where: { order: { assignments: { some: { partnerId: partner.id } } } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        category: true,
        status: true,
        createdAt: true,
        responses: {
          where: { responderId: ownerId },
          select: { responseCode: true },
        },
      },
    });
  }

  async partnerRespond(
    ownerId: string,
    disputeId: string,
    key: string | undefined,
    input: PartnerDisputeResponseDto,
  ) {
    const partner = await this.requirePartner(ownerId);
    const located = await this.prisma.disputeCase.findFirst({
      where: {
        id: disputeId,
        order: { assignments: { some: { partnerId: partner.id } } },
      },
    });
    if (!located) throw new NotFoundException();
    return this.command(
      ownerId,
      located.orderId,
      "PARTNER_RESPONSE",
      key,
      { disputeId, ...input },
      async (tx) => {
        const dispute = await tx.disputeCase.findUniqueOrThrow({
          where: { id: disputeId },
        });
        if (dispute.status !== "OPEN")
          throw new ConflictException({ code: "DISPUTE_NOT_OPEN" });
        await tx.disputeResponse.create({
          data: {
            disputeId,
            responderId: ownerId,
            responseCode: input.responseCode,
          },
        });
        await tx.disputeCase.update({
          where: { id: disputeId, version: dispute.version, status: "OPEN" },
          data: { status: "PARTNER_RESPONDED", version: { increment: 1 } },
        });
        await tx.outboxEvent.create({
          data: event(
            "dispute",
            disputeId,
            dispute.version + 1,
            "DISPUTE_PARTNER_RESPONDED",
          ),
        });
        return {
          disputeId,
          responseCode: input.responseCode,
          status: "PARTNER_RESPONDED",
        };
      },
    );
  }

  adminList() {
    return this.prisma.disputeCase.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        category: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
      },
    });
  }
  async adminDetail(id: string) {
    const x = await this.prisma.disputeCase.findUnique({
      where: { id },
      include: {
        resolution: true,
        responses: { select: { responseCode: true, createdAt: true } },
        order: {
          include: {
            payment: { include: { refunds: true } },
            productionCycles: {
              select: { sequence: true, kind: true, status: true },
            },
          },
        },
      },
    });
    if (!x) throw new NotFoundException();
    const paid = x.order.payment?.amountMinor ?? 0n;
    const reserved =
      x.order.payment?.refunds.reduce((sum, r) => sum + r.amountMinor, 0n) ??
      0n;
    return {
      id: x.id,
      orderId: x.orderId,
      category: x.category,
      structuredComment: x.structuredComment,
      status: x.status,
      openedFromStatus: x.openedFromStatus,
      responses: x.responses,
      refundableMinor: (paid - reserved).toString(),
      cycles: x.order.productionCycles,
      resolution: x.resolution && {
        type: x.resolution.type,
        refundAmountMinor: x.resolution.refundAmountMinor?.toString() ?? null,
        currency: x.resolution.currency,
      },
    };
  }

  async resolve(
    actorId: string,
    disputeId: string,
    key: string | undefined,
    input: ResolveDisputeDto,
  ) {
    const located = await this.prisma.disputeCase.findUnique({
      where: { id: disputeId },
    });
    if (!located) throw new NotFoundException();
    return this.command(
      actorId,
      located.orderId,
      "RESOLVE_DISPUTE",
      key,
      { disputeId, ...input },
      async (tx) => {
        const dispute = await tx.disputeCase.findUniqueOrThrow({
          where: { id: disputeId },
          include: {
            order: {
              include: {
                payment: { include: { refunds: true } },
                assignments: {
                  orderBy: { acceptedAt: "desc" },
                  take: 1,
                  include: { partner: true, branch: true },
                },
                productionCycles: true,
                printReadyVersion: true,
              },
            },
          },
        });
        if (
          !(activeDisputes as readonly string[]).includes(dispute.status) ||
          dispute.order.status !== "DISPUTED"
        )
          throw new ConflictException({ code: "DISPUTE_ALREADY_DECIDED" });
        const payment = dispute.order.payment;
        const reserved =
          payment?.refunds.reduce((sum, r) => sum + r.amountMinor, 0n) ?? 0n;
        const amount = refundAmount(
          input.resolution,
          input.refundAmountMinor,
          payment?.amountMinor ?? 0n,
          reserved,
        );
        if (
          amount !== null &&
          (!payment ||
            !["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status))
        )
          throw new ConflictException({ code: "PAYMENT_NOT_REFUNDABLE" });
        const resolution = await tx.disputeResolution.create({
          data: {
            disputeId,
            resolverId: actorId,
            type: input.resolution,
            refundAmountMinor: amount,
            currency: amount === null ? null : "UZS",
            ruleVersion: "stage8-v1",
            allocationInputs: {
              resolution: input.resolution,
              settlement: "NOT_EXECUTED",
              customerChargeMinor: "0",
              newPartnerPayoutMinor: "0",
            },
          },
        });
        let orderStatus: OrderStatus = dispute.openedFromStatus;
        let cycleId: string | null = null;
        let refundId: string | null = null;
        if (input.resolution === "REPRINT") {
          const assignment = dispute.order.assignments[0];
          if (
            !assignment ||
            assignment.partner.status !== "APPROVED" ||
            !assignment.branch.active
          )
            throw new ConflictException({
              code: "REPRINT_PARTNER_UNAVAILABLE",
            });
          const objectKey = dispute.order.printReadyVersion.objectKey;
          const ref = await tx.permanentObjectReference.findUnique({
            where: { objectKey },
          });
          if (
            !ref ||
            ref.deletedAt ||
            (await tx.retentionTombstone.findUnique({ where: { objectKey } }))
          )
            throw new ConflictException({ code: "REPRINT_FILE_UNAVAILABLE" });
          const cycle = await tx.productionCycle.create({
            data: {
              orderId: dispute.orderId,
              sequence:
                Math.max(
                  0,
                  ...dispute.order.productionCycles.map((c) => c.sequence),
                ) + 1,
              kind: "REPRINT",
              printReadyVersionId: dispute.order.printReadyVersionId,
              assignmentId: assignment.id,
              resolutionId: resolution.id,
            },
          });
          await tx.printJob.create({
            data: {
              orderId: dispute.orderId,
              productionCycleId: cycle.id,
              assignmentId: assignment.id,
              branchId: assignment.branchId,
            },
          });
          await tx.partnerAssignment.update({
            where: { id: assignment.id, version: assignment.version },
            data: { active: true, status: "ACTIVE", version: { increment: 1 } },
          });
          await protectObjects(tx, dispute.orderId);
          orderStatus = "REPRINT";
          cycleId = cycle.id;
        } else if (amount !== null && payment) {
          await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${payment.id}::uuid FOR UPDATE`;
          const refund = await tx.refundOperation.create({
            data: {
              paymentId: payment.id,
              disputeId,
              kind: input.resolution === "FULL_REFUND" ? "FULL" : "PARTIAL",
              triggerDedupKey: digest(
                "DISPUTE:" + disputeId + ":" + input.resolution,
              ),
              amountMinor: amount,
            },
          });
          await tx.payment.update({
            where: { id: payment.id, version: payment.version },
            data: { status: "REFUND_PENDING", version: { increment: 1 } },
          });
          await tx.outboxEvent.create({
            data: event("refund", refund.id, 0, "AFTERCARE_REFUND_REQUESTED"),
          });
          orderStatus = "REFUND_PENDING";
          refundId = refund.id;
        }
        await tx.disputeCase.update({
          where: {
            id: disputeId,
            version: dispute.version,
            status: dispute.status,
          },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await tx.legalHold.updateMany({
          where: { disputeId, releasedAt: null },
          data: { releasedAt: new Date(), releasedById: actorId },
        });
        await this.transition(
          tx,
          dispute.orderId,
          dispute.order.version,
          "DISPUTED",
          orderStatus,
        );
        await tx.outboxEvent.create({
          data: event(
            "dispute",
            disputeId,
            dispute.version + 1,
            "DISPUTE_RESOLVED",
          ),
        });
        return {
          disputeId,
          resolution: input.resolution,
          orderStatus,
          productionCycleId: cycleId,
          refundOperationId: refundId,
          refundStatus: amount === null ? null : "REQUESTED",
        };
      },
    );
  }

  async createHold(
    actorId: string,
    orderId: string,
    key: string | undefined,
    input: CreateLegalHoldDto,
  ) {
    return this.command(
      actorId,
      orderId,
      "CREATE_HOLD",
      key,
      input,
      async (tx) => {
        if (!(await tx.order.findUnique({ where: { id: orderId } })))
          throw new NotFoundException();
        const hold = await tx.legalHold.create({
          data: { orderId, reasonCode: input.reasonCode, createdById: actorId },
        });
        await protectObjects(tx, orderId);
        await tx.outboxEvent.create({
          data: event("hold", hold.id, 0, "LEGAL_HOLD_CREATED"),
        });
        return { holdId: hold.id, status: "ACTIVE" };
      },
    );
  }

  async releaseHold(
    actorId: string,
    orderId: string,
    holdId: string,
    key: string | undefined,
  ) {
    return this.command(
      actorId,
      orderId,
      "RELEASE_HOLD",
      key,
      { holdId },
      async (tx) => {
        const hold = await tx.legalHold.findFirst({
          where: { id: holdId, orderId, releasedAt: null },
        });
        if (!hold) throw new NotFoundException();
        if (hold.disputeId)
          throw new ConflictException({
            code: "DISPUTE_HOLD_REQUIRES_RESOLUTION",
          });
        await tx.legalHold.update({
          where: { id: holdId },
          data: { releasedAt: new Date(), releasedById: actorId },
        });
        await tx.outboxEvent.create({
          data: event("hold", holdId, 1, "LEGAL_HOLD_RELEASED"),
        });
        return { holdId, status: "RELEASED" };
      },
    );
  }

  async retentionStatus() {
    const [active, held, pendingDeletion, holds] = await Promise.all([
      this.prisma.retentionSchedule.count({ where: { status: "ACTIVE" } }),
      this.prisma.legalHold.count({ where: { releasedAt: null } }),
      this.prisma.retentionTombstone.count({
        where: { applyStatus: "PENDING" },
      }),
      this.prisma.legalHold.findMany({
        where: { releasedAt: null },
        take: 100,
        select: { id: true, orderId: true, reasonCode: true, createdAt: true },
      }),
    ]);
    return { active, held, pendingDeletion, holds };
  }

  private async requireOwned(userId: string, orderId: string) {
    if (
      !(await this.prisma.order.findFirst({ where: { id: orderId, userId } }))
    )
      throw new NotFoundException();
  }
  private async requirePartner(ownerId: string) {
    const p = await this.prisma.partner.findFirst({
      where: { ownerId, status: "APPROVED" },
    });
    if (!p) throw new ForbiddenException();
    return p;
  }
  private async transition(
    tx: Prisma.TransactionClient,
    orderId: string,
    version: number,
    from: OrderStatus,
    to: OrderStatus,
  ) {
    const changed = await tx.order.updateMany({
      where: { id: orderId, version, status: from },
      data: { status: to, version: { increment: 1 } },
    });
    if (changed.count !== 1)
      throw new ConflictException({ code: "ORDER_VERSION_CONFLICT" });
    await tx.outboxEvent.create({
      data: event("order", orderId, version + 1, "AFTERCARE_ORDER_CHANGED"),
    });
  }
}
