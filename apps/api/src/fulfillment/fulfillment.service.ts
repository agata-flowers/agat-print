import { createHash } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { IdempotencyService } from "../commerce/idempotency.service";
import type { AppEnvironment } from "../config/environment";
import { PrismaService } from "../prisma/prisma.service";
import {
  APP_ENVIRONMENT,
  PrivateObjectStorageService,
} from "../uploads/private-object-storage.service";
import type {
  ConfirmPinDto,
  CourierApplicationDto,
  DeliveryFailureDto,
  PrinterJobStatusDto,
  RequestFulfillmentDto,
} from "./dto";
import { FulfillmentCrypto } from "./fulfillment.crypto";
import { MockDeliveryProvider } from "./mock-delivery.provider";

const sha256 = (value: string) =>
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
  dedupKey: sha256(
    `${aggregateType}:${aggregateId}:${aggregateVersion}:${eventType}`,
  ),
  payload: { aggregateId, aggregateVersion },
});

@Injectable()
export class FulfillmentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FulfillmentCrypto) private readonly crypto: FulfillmentCrypto,
    @Inject(MockDeliveryProvider)
    private readonly deliveryProvider: MockDeliveryProvider,
    @Inject(PrivateObjectStorageService)
    private readonly storage: PrivateObjectStorageService,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {}

  async requestFulfillment(
    userId: string,
    orderId: string,
    key: string | undefined,
    input: RequestFulfillmentDto,
  ) {
    if (
      (input.mode === "DELIVERY" && !input.deliveryAddress) ||
      (input.mode === "PICKUP" && input.deliveryAddress)
    )
      throw new ConflictException({ code: "FULFILLMENT_INPUT_INVALID" });
    const prepared = this.idempotency.prepare(
      `order-fulfillment:${orderId}`,
      key,
      input,
    );
    const existing = await this.prisma.orderFulfillment.findUnique({
      where: { orderId },
      include: { order: { select: { userId: true, status: true } } },
    });
    if (existing) return this.replayFulfillment(userId, existing, prepared);

    const completionNonce = this.crypto.nonce();
    const completionPin = this.crypto.pin("completion", completionNonce);
    const handoffNonce = input.mode === "DELIVERY" ? this.crypto.nonce() : null;
    const address = input.deliveryAddress
      ? this.crypto.encryptAddress(input.deliveryAddress)
      : null;
    try {
      const value = await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid FOR UPDATE`;
          const insideExisting = await tx.orderFulfillment.findUnique({
            where: { orderId },
            include: { order: { select: { userId: true, status: true } } },
          });
          if (insideExisting)
            return this.replayFulfillment(userId, insideExisting, prepared);
          const order = await tx.order.findFirst({
            where: { id: orderId, userId },
            include: { assignments: { orderBy: { acceptedAt: "desc" } } },
          });
          if (!order) throw new NotFoundException();
          if (
            order.status !== "READY" ||
            order.assignments[0]?.status !== "READY"
          )
            throw new ConflictException({ code: "ORDER_NOT_READY" });
          const created = await tx.orderFulfillment.create({
            data: {
              orderId,
              mode: input.mode,
              requestKeyDigest: prepared.keyDigest,
              requestHash: prepared.requestHash,
              completionNonce,
              completionPinDigest: this.crypto.pinDigest(
                "completion",
                completionNonce,
                completionPin,
              ),
              completionExpiresAt: new Date(
                Date.now() + this.env.pickupPinTtlSeconds * 1_000,
              ),
              handoffNonce,
              handoffPinDigest: handoffNonce
                ? this.crypto.pinDigest(
                    "handoff",
                    handoffNonce,
                    this.crypto.pin("handoff", handoffNonce),
                  )
                : null,
              ...(address ?? {}),
            },
          });
          const changed = await tx.order.updateMany({
            where: { id: orderId, version: order.version, status: "READY" },
            data: { status: "AWAITING_PICKUP", version: { increment: 1 } },
          });
          if (changed.count !== 1)
            throw new ConflictException({ code: "ORDER_VERSION_CONFLICT" });
          await tx.outboxEvent.create({
            data: outbox(
              "order",
              orderId,
              order.version + 1,
              input.mode === "DELIVERY"
                ? "DELIVERY_REQUESTED"
                : "PICKUP_REQUESTED",
            ),
          });
          return {
            orderId,
            fulfillmentId: created.id,
            mode: created.mode,
            orderStatus: "AWAITING_PICKUP",
            completionPin,
            expiresAt: created.completionExpiresAt,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      await this.audit.record("FULFILLMENT_REQUESTED", userId, "order", {
        status: "AWAITING_PICKUP",
        operation: input.mode,
      });
      return value;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(error.code)
      ) {
        const raced = await this.prisma.orderFulfillment.findUnique({
          where: { orderId },
          include: { order: { select: { userId: true, status: true } } },
        });
        if (raced) return this.replayFulfillment(userId, raced, prepared);
      }
      throw error;
    }
  }

  async applyCourier(userId: string, input: CourierApplicationDto) {
    const existing = await this.prisma.courierProfile.findUnique({
      where: { userId },
    });
    if (existing) return this.courierView(existing);
    const courier = await this.prisma.courierProfile.create({
      data: { userId, ...input },
    });
    await this.audit.record(
      "COURIER_APPLICATION_SUBMITTED",
      userId,
      "courier",
      {
        status: "PENDING",
        operation: "CREATE",
      },
    );
    return this.courierView(courier);
  }

  async ownCourier(userId: string) {
    const courier = await this.prisma.courierProfile.findUnique({
      where: { userId },
    });
    if (!courier) throw new NotFoundException();
    return this.courierView(courier);
  }

  async approveCourier(actorId: string, courierId: string) {
    const courier = await this.prisma.$transaction(async (tx) => {
      const current = await tx.courierProfile.findUnique({
        where: { id: courierId },
      });
      if (!current) throw new NotFoundException();
      if (current.status !== "PENDING")
        throw new ConflictException({ code: "COURIER_ALREADY_REVIEWED" });
      const approved = await tx.courierProfile.update({
        where: { id: courierId },
        data: { status: "APPROVED", approvedAt: new Date() },
      });
      await tx.userRole.upsert({
        where: { userId_role: { userId: current.userId, role: "COURIER" } },
        create: { userId: current.userId, role: "COURIER" },
        update: {},
      });
      return approved;
    });
    await this.audit.record("COURIER_APPROVED", actorId, "courier", {
      status: "APPROVED",
      operation: "APPROVE",
    });
    return this.courierView(courier);
  }

  async adminCouriers() {
    const couriers = await this.prisma.courierProfile.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return couriers.map((courier) => this.courierView(courier));
  }

  async suspendCourier(actorId: string, courierId: string) {
    const activeDelivery = await this.prisma.deliveryTask.findFirst({
      where: { courierId, active: true },
    });
    if (activeDelivery)
      throw new ConflictException({ code: "COURIER_HAS_ACTIVE_DELIVERY" });
    const changed = await this.prisma.courierProfile.updateMany({
      where: { id: courierId, status: "APPROVED" },
      data: { status: "SUSPENDED", active: false },
    });
    if (changed.count !== 1) throw new NotFoundException();
    await this.audit.record("COURIER_SUSPENDED", actorId, "courier", {
      status: "SUSPENDED",
      operation: "SUSPEND",
    });
    return { status: "SUSPENDED", active: false };
  }

  async assignDelivery(orderId: string, deliveryDedupKey: string) {
    if (
      await this.prisma.inboxOperation.findUnique({
        where: { dedupKey: deliveryDedupKey },
      })
    )
      return { duplicate: true };
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        fulfillment: true,
        assignments: {
          include: { branch: true },
          orderBy: { acceptedAt: "desc" },
        },
      },
    });
    if (!order?.fulfillment || order.fulfillment.mode !== "DELIVERY")
      throw new NotFoundException();
    const assignment = order.assignments[0];
    if (!assignment)
      throw new ConflictException({ code: "ASSIGNMENT_MISSING" });
    const courier = await this.prisma.courierProfile.findFirst({
      where: {
        status: "APPROVED",
        active: true,
        serviceZone: assignment.branch.locationCode,
        deliveries: { none: { active: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!courier)
      return this.failNoCourier(
        orderId,
        order.fulfillment.id,
        deliveryDedupKey,
      );
    const provider = await this.deliveryProvider.createDelivery(orderId, {
      idempotencyKey: deliveryDedupKey,
      correlationId: orderId,
    });
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "CourierProfile" WHERE id = ${courier.id}::uuid FOR UPDATE`;
        const prior = await tx.inboxOperation.findUnique({
          where: { dedupKey: deliveryDedupKey },
        });
        if (prior) return { duplicate: true };
        const current = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
        });
        const currentCourier = await tx.courierProfile.findFirst({
          where: {
            id: courier.id,
            status: "APPROVED",
            active: true,
            deliveries: { none: { active: true } },
          },
        });
        if (!currentCourier || current.status !== "AWAITING_PICKUP")
          throw new ConflictException({ code: "DELIVERY_ASSIGNMENT_CONFLICT" });
        const delivery = await tx.deliveryTask.create({
          data: {
            orderId,
            fulfillmentId: order.fulfillment!.id,
            courierId: courier.id,
            branchId: assignment.branchId,
            providerReference: provider.reference,
          },
        });
        const changed = await tx.order.updateMany({
          where: {
            id: orderId,
            version: current.version,
            status: "AWAITING_PICKUP",
          },
          data: { status: "COURIER_ASSIGNED", version: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw new ConflictException({ code: "ORDER_VERSION_CONFLICT" });
        await tx.inboxOperation.create({
          data: {
            dedupKey: deliveryDedupKey,
            operation: "ASSIGN_COURIER",
            resultId: delivery.id,
          },
        });
        await tx.outboxEvent.create({
          data: outbox(
            "order",
            orderId,
            current.version + 1,
            "COURIER_ASSIGNED",
          ),
        });
        return { duplicate: false, deliveryId: delivery.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async completePickup(
    ownerId: string,
    orderId: string,
    key: string | undefined,
    input: ConfirmPinDto,
  ) {
    const partner = await this.requireApprovedPartner(ownerId);
    return this.completeWithPin(
      "partner-pickup",
      ownerId,
      orderId,
      key,
      input.pin,
      (_tx, order) => {
        const owned = order.assignments.some(
          (item) => item.partnerId === partner.id,
        );
        if (!owned) throw new NotFoundException();
        if (
          order.fulfillment?.mode !== "PICKUP" ||
          order.status !== "AWAITING_PICKUP"
        )
          throw new ConflictException({ code: "INVALID_PICKUP_TRANSITION" });
      },
    );
  }

  async handoffDelivery(
    ownerId: string,
    deliveryId: string,
    key: string | undefined,
    input: ConfirmPinDto,
  ) {
    const partner = await this.requireApprovedPartner(ownerId);
    const prepared = this.idempotency.prepare(
      `delivery-handoff:${deliveryId}`,
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) {
      if (replay.errorCode === "PIN_INVALID")
        throw new UnauthorizedException({ code: "PIN_INVALID" });
      return replay;
    }
    let outcome;
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        const located = await tx.deliveryTask.findUnique({
          where: { id: deliveryId },
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
        if (insideReplay) {
          const response = this.idempotency.assertCompatible(
            insideReplay,
            prepared,
          ) as Record<string, unknown>;
          return response.errorCode === "PIN_INVALID"
            ? { invalid: true as const }
            : { invalid: false as const, response };
        }
        const delivery = await tx.deliveryTask.findFirst({
          where: { id: deliveryId, branch: { partnerId: partner.id } },
          include: { order: true, fulfillment: true },
        });
        if (!delivery) throw new NotFoundException();
        if (
          delivery.order.status !== "COURIER_ASSIGNED" ||
          delivery.status !== "ASSIGNED"
        )
          throw new ConflictException({ code: "INVALID_DELIVERY_TRANSITION" });
        const fulfillment = delivery.fulfillment;
        if (
          !fulfillment.handoffNonce ||
          !fulfillment.handoffPinDigest ||
          fulfillment.handoffAttempts >= this.env.pickupPinMaxAttempts
        ) {
          await tx.idempotencyRecord.create({
            data: this.idempotency.data(
              prepared,
              { errorCode: "PIN_INVALID" },
              401,
            ),
          });
          return { invalid: true as const };
        }
        if (
          !this.crypto.verifyPin(
            "handoff",
            fulfillment.handoffNonce,
            input.pin,
            fulfillment.handoffPinDigest,
          )
        ) {
          await tx.orderFulfillment.update({
            where: { id: fulfillment.id },
            data: {
              handoffAttempts: { increment: 1 },
              version: { increment: 1 },
            },
          });
          await tx.idempotencyRecord.create({
            data: this.idempotency.data(
              prepared,
              { errorCode: "PIN_INVALID" },
              401,
            ),
          });
          return { invalid: true as const };
        }
        await tx.deliveryTask.update({
          where: { id: delivery.id },
          data: {
            status: "IN_DELIVERY",
            pickedUpAt: new Date(),
            version: { increment: 1 },
          },
        });
        await tx.orderFulfillment.update({
          where: { id: fulfillment.id },
          data: {
            status: "IN_DELIVERY",
            handoffUsedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await tx.order.update({
          where: { id: delivery.orderId },
          data: { status: "IN_DELIVERY", version: { increment: 1 } },
        });
        const response = { deliveryId, orderStatus: "IN_DELIVERY" };
        await tx.idempotencyRecord.create({
          data: this.idempotency.data(prepared, response),
        });
        await tx.outboxEvent.create({
          data: outbox(
            "order",
            delivery.orderId,
            delivery.order.version + 1,
            "ORDER_IN_DELIVERY",
          ),
        });
        return { invalid: false as const, response };
      });
    } catch (error) {
      const recovered = await this.recoverIdempotencyRace(prepared, error);
      if (recovered) {
        if (recovered.errorCode === "PIN_INVALID")
          throw new UnauthorizedException({ code: "PIN_INVALID" });
        return recovered;
      }
      throw error;
    }
    if (outcome.invalid)
      throw new UnauthorizedException({ code: "PIN_INVALID" });
    await this.audit.record("DELIVERY_HANDED_OFF", ownerId, "delivery", {
      status: "IN_DELIVERY",
      operation: "PIN",
    });
    return outcome.response;
  }

  async activeDelivery(userId: string) {
    const courier = await this.requireApprovedCourier(userId);
    const delivery = await this.prisma.deliveryTask.findFirst({
      where: { courierId: courier.id, active: true },
      include: {
        order: true,
        fulfillment: true,
        branch: { select: { name: true } },
      },
      orderBy: { assignedAt: "asc" },
    });
    if (!delivery) return null;
    const fulfillment = delivery.fulfillment;
    return {
      id: delivery.id,
      orderStatus: delivery.order.status,
      status: delivery.status,
      branchName: delivery.branch.name,
      handoffPin:
        delivery.status === "ASSIGNED" && fulfillment.handoffNonce
          ? this.crypto.pin("handoff", fulfillment.handoffNonce)
          : undefined,
      deliveryAddress:
        fulfillment.addressCiphertext &&
        fulfillment.addressIv &&
        fulfillment.addressAuthTag
          ? this.crypto.decryptAddress(
              fulfillment.addressCiphertext,
              fulfillment.addressIv,
              fulfillment.addressAuthTag,
            )
          : undefined,
    };
  }

  async completeDelivery(
    userId: string,
    deliveryId: string,
    key: string | undefined,
    input: ConfirmPinDto,
  ) {
    const courier = await this.requireApprovedCourier(userId);
    const delivery = await this.prisma.deliveryTask.findFirst({
      where: { id: deliveryId, courierId: courier.id },
    });
    if (!delivery) throw new NotFoundException();
    return this.completeWithPin(
      "courier-delivery",
      userId,
      delivery.orderId,
      key,
      input.pin,
      (_tx, order) => {
        if (
          order.fulfillment?.mode !== "DELIVERY" ||
          order.status !== "IN_DELIVERY" ||
          order.deliveryTask?.id !== deliveryId
        )
          throw new ConflictException({ code: "INVALID_DELIVERY_TRANSITION" });
      },
      deliveryId,
    );
  }

  async failDelivery(
    userId: string,
    deliveryId: string,
    key: string | undefined,
    input: DeliveryFailureDto,
  ) {
    const courier = await this.requireApprovedCourier(userId);
    const prepared = this.idempotency.prepare(
      `delivery-fail:${deliveryId}`,
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    let response;
    try {
      response = await this.prisma.$transaction(async (tx) => {
        const located = await tx.deliveryTask.findFirst({
          where: { id: deliveryId, courierId: courier.id },
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
        const delivery = await tx.deliveryTask.findUniqueOrThrow({
          where: { id: deliveryId },
          include: { order: true },
        });
        if (
          !delivery.active ||
          !["COURIER_ASSIGNED", "IN_DELIVERY"].includes(delivery.order.status)
        )
          throw new ConflictException({ code: "INVALID_DELIVERY_TRANSITION" });
        await tx.deliveryTask.update({
          where: { id: deliveryId },
          data: {
            status: "FAILED",
            active: false,
            failedAt: new Date(),
            failureCode: input.reason,
            version: { increment: 1 },
          },
        });
        await tx.orderFulfillment.update({
          where: { id: delivery.fulfillmentId },
          data: { status: "FAILED", version: { increment: 1 } },
        });
        await tx.order.update({
          where: { id: delivery.orderId },
          data: { status: "DELIVERY_FAILED", version: { increment: 1 } },
        });
        const value = { deliveryId, orderStatus: "DELIVERY_FAILED" };
        await tx.idempotencyRecord.create({
          data: this.idempotency.data(prepared, value),
        });
        await tx.outboxEvent.create({
          data: outbox(
            "order",
            delivery.orderId,
            delivery.order.version + 1,
            "DELIVERY_FAILED",
          ),
        });
        return value;
      });
    } catch (error) {
      const recovered = await this.recoverIdempotencyRace(prepared, error);
      if (recovered) return recovered;
      throw error;
    }
    await this.audit.record("DELIVERY_FAILED", userId, "delivery", {
      status: "DELIVERY_FAILED",
      operation: input.reason,
    });
    return response;
  }

  async registerPrinterAgent(actorId: string, branchId: string, label: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch) throw new NotFoundException();
    const token = this.crypto.token();
    const agent = await this.prisma.printerAgent.create({
      data: {
        branchId,
        label,
        tokenDigest: this.crypto.agentDigest(token),
        createdById: actorId,
      },
    });
    await this.audit.record(
      "PRINTER_AGENT_REGISTERED",
      actorId,
      "printer-agent",
      {
        status: "ACTIVE",
        operation: "REGISTER",
      },
    );
    return { agentId: agent.id, token, status: agent.status };
  }

  async revokePrinterAgent(actorId: string, agentId: string) {
    const leased = await this.prisma.printJob.findFirst({
      where: { agentId, status: { in: ["LEASED", "PRINTING"] } },
    });
    if (leased)
      throw new ConflictException({ code: "PRINTER_AGENT_HAS_ACTIVE_JOB" });
    const changed = await this.prisma.printerAgent.updateMany({
      where: { id: agentId, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    if (changed.count !== 1) throw new NotFoundException();
    await this.audit.record("PRINTER_AGENT_REVOKED", actorId, "printer-agent", {
      status: "REVOKED",
      operation: "REVOKE",
    });
    return { status: "REVOKED" };
  }

  async createPrintJob(orderId: string, deliveryDedupKey: string) {
    if (
      await this.prisma.inboxOperation.findUnique({
        where: { dedupKey: deliveryDedupKey },
      })
    )
      return { duplicate: true };
    return this.prisma.$transaction(async (tx) => {
      const prior = await tx.inboxOperation.findUnique({
        where: { dedupKey: deliveryDedupKey },
      });
      if (prior) return { duplicate: true };
      const assignment = await tx.partnerAssignment.findFirst({
        where: { orderId },
        include: { order: true },
        orderBy: { acceptedAt: "desc" },
      });
      if (!assignment || assignment.order.status !== "PARTNER_ACCEPTED")
        throw new ConflictException({ code: "PRINT_JOB_NOT_ELIGIBLE" });
      const job = await tx.printJob.upsert({
        where: { orderId },
        create: {
          orderId,
          assignmentId: assignment.id,
          branchId: assignment.branchId,
        },
        update: {},
      });
      await tx.inboxOperation.create({
        data: {
          dedupKey: deliveryDedupKey,
          operation: "CREATE_PRINT_JOB",
          resultId: job.id,
        },
      });
      return { duplicate: false, jobId: job.id };
    });
  }

  async claimPrintJob(
    agent: { id: string; branchId: string },
    key: string | undefined,
  ) {
    const prepared = this.idempotency.prepare(
      `printer-claim:${agent.id}`,
      key,
      {},
    );
    const deliveryDedupKey = sha256(
      `${prepared.scope}:${prepared.keyDigest}:${prepared.requestHash}`,
    );
    const prior = await this.prisma.inboxOperation.findUnique({
      where: { dedupKey: deliveryDedupKey },
    });
    if (prior?.resultId) return this.printJobDownload(agent.id, prior.resultId);
    let claimed: string | null;
    try {
      claimed = await this.prisma.$transaction(
        async (tx) => {
          const insidePrior = await tx.inboxOperation.findUnique({
            where: { dedupKey: deliveryDedupKey },
          });
          if (insidePrior?.resultId) return insidePrior.resultId;
          const candidates = await tx.printJob.findMany({
            where: {
              branchId: agent.branchId,
              OR: [
                { status: "PENDING" },
                { status: "LEASED", leaseUntil: { lt: new Date() } },
              ],
              order: { status: { in: ["PARTNER_ACCEPTED", "IN_PRODUCTION"] } },
            },
            orderBy: { createdAt: "asc" },
            take: 1,
          });
          const job = candidates[0];
          if (!job) return null;
          const changed = await tx.printJob.updateMany({
            where: { id: job.id, version: job.version, status: job.status },
            data: {
              status: "LEASED",
              agentId: agent.id,
              leaseUntil: new Date(
                Date.now() + this.env.printerAgentLeaseSeconds * 1_000,
              ),
              attempts: { increment: 1 },
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1)
            throw new ConflictException({ code: "PRINT_JOB_CLAIM_CONFLICT" });
          await tx.inboxOperation.create({
            data: {
              dedupKey: deliveryDedupKey,
              operation: "CLAIM_PRINT_JOB",
              resultId: job.id,
            },
          });
          return job.id;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const prismaError =
        error instanceof Prisma.PrismaClientKnownRequestError ? error : null;
      if (
        prismaError?.code === "P2002" ||
        prismaError?.code === "P2034" ||
        prismaError?.code === "P2010"
      ) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const recovered = await this.prisma.inboxOperation.findUnique({
            where: { dedupKey: deliveryDedupKey },
          });
          if (recovered?.resultId)
            return this.printJobDownload(agent.id, recovered.resultId);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      throw error;
    }
    return claimed ? this.printJobDownload(agent.id, claimed) : null;
  }

  async setPrintJobStatus(
    agent: { id: string },
    jobId: string,
    key: string | undefined,
    input: PrinterJobStatusDto,
  ) {
    const prepared = this.idempotency.prepare(
      `printer-job:${jobId}`,
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    let response;
    try {
      response = await this.prisma.$transaction(
        async (tx) => {
          const located = await tx.printJob.findFirst({
            where: { id: jobId, agentId: agent.id },
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
          const job = await tx.printJob.findUniqueOrThrow({
            where: { id: jobId },
            include: { order: true, assignment: true },
          });
          if (
            job.agentId !== agent.id ||
            !job.leaseUntil ||
            job.leaseUntil < new Date()
          )
            throw new ConflictException({ code: "PRINT_JOB_LEASE_EXPIRED" });
          if (input.status === "FAILED") {
            if (!input.failureCode)
              throw new ConflictException({
                code: "PRINT_FAILURE_CODE_REQUIRED",
              });
            const value = { jobId, status: "PENDING" };
            await tx.printJob.update({
              where: { id: jobId },
              data: {
                status: "PENDING",
                agentId: null,
                leaseUntil: null,
                failureCode: input.failureCode,
                version: { increment: 1 },
              },
            });
            await tx.idempotencyRecord.create({
              data: this.idempotency.data(prepared, value),
            });
            return value;
          }
          const expectedJob =
            input.status === "PRINTING" ? "LEASED" : "PRINTING";
          if (job.status !== expectedJob)
            throw new ConflictException({
              code: "INVALID_PRINT_JOB_TRANSITION",
            });
          if (
            input.status === "PRINTING" &&
            !["PARTNER_ACCEPTED", "IN_PRODUCTION"].includes(job.order.status)
          )
            throw new ConflictException({
              code: "INVALID_PRODUCTION_TRANSITION",
            });
          if (
            input.status === "COMPLETED" &&
            job.order.status !== "IN_PRODUCTION"
          )
            throw new ConflictException({
              code: "INVALID_PRODUCTION_TRANSITION",
            });
          await tx.printJob.update({
            where: { id: jobId },
            data: {
              status: input.status,
              startedAt:
                input.status === "PRINTING" ? new Date() : job.startedAt,
              completedAt: input.status === "COMPLETED" ? new Date() : null,
              version: { increment: 1 },
            },
          });
          let orderStatus = job.order.status;
          let nextOrderVersion: number | undefined;
          if (
            input.status === "PRINTING" &&
            job.order.status === "PARTNER_ACCEPTED"
          ) {
            orderStatus = "IN_PRODUCTION";
            nextOrderVersion = job.order.version + 1;
            await tx.order.update({
              where: { id: job.orderId },
              data: { status: "IN_PRODUCTION", version: { increment: 1 } },
            });
          }
          if (input.status === "COMPLETED") {
            orderStatus = "READY";
            nextOrderVersion = job.order.version + 1;
            await tx.order.update({
              where: { id: job.orderId },
              data: { status: "READY", version: { increment: 1 } },
            });
            await tx.partnerAssignment.update({
              where: { id: job.assignmentId },
              data: {
                status: "READY",
                active: false,
                readyAt: new Date(),
                version: { increment: 1 },
              },
            });
          }
          const value = { jobId, status: input.status, orderStatus };
          await tx.idempotencyRecord.create({
            data: this.idempotency.data(prepared, value),
          });
          if (nextOrderVersion)
            await tx.outboxEvent.create({
              data: outbox(
                "order",
                job.orderId,
                nextOrderVersion,
                input.status === "PRINTING"
                  ? "ORDER_IN_PRODUCTION"
                  : "ORDER_READY",
              ),
            });
          return value;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const recovered = await this.recoverIdempotencyRace(prepared, error);
      if (recovered) return recovered;
      throw error;
    }
    await this.audit.record(
      "PRINTER_JOB_STATUS_CHANGED",
      undefined,
      "print-job",
      {
        status: input.status,
        operation: "AGENT",
      },
    );
    return response;
  }

  async adminFulfillment() {
    const orders = await this.prisma.order.findMany({
      where: { fulfillment: { isNot: null } },
      include: { fulfillment: true, deliveryTask: true, printJob: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return orders.map((order) => ({
      orderId: order.id,
      orderStatus: order.status,
      mode: order.fulfillment?.mode,
      fulfillmentStatus: order.fulfillment?.status,
      deliveryStatus: order.deliveryTask?.status ?? null,
      printJobStatus: order.printJob?.status ?? null,
    }));
  }

  private replayFulfillment(
    userId: string,
    existing: {
      orderId: string;
      id: string;
      mode: "PICKUP" | "DELIVERY";
      requestKeyDigest: string;
      requestHash: string;
      completionNonce: string;
      completionExpiresAt: Date;
      order: { userId: string; status: string };
    },
    prepared: ReturnType<IdempotencyService["prepare"]>,
  ) {
    if (existing.order.userId !== userId) throw new NotFoundException();
    if (
      existing.requestKeyDigest !== prepared.keyDigest ||
      existing.requestHash !== prepared.requestHash
    )
      throw new ConflictException({ code: "IDEMPOTENCY_KEY_CONFLICT" });
    return {
      orderId: existing.orderId,
      fulfillmentId: existing.id,
      mode: existing.mode,
      orderStatus: existing.order.status,
      completionPin: this.crypto.pin("completion", existing.completionNonce),
      expiresAt: existing.completionExpiresAt,
    };
  }

  private async completeWithPin(
    scope: string,
    actorId: string,
    orderId: string,
    key: string | undefined,
    pin: string,
    authorize: (
      tx: Prisma.TransactionClient,
      order: Prisma.OrderGetPayload<{
        include: { fulfillment: true; assignments: true; deliveryTask: true };
      }>,
    ) => void | Promise<void>,
    deliveryId?: string,
  ) {
    const prepared = this.idempotency.prepare(`${scope}:${orderId}`, key, {
      pin,
    });
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) {
      if (replay.errorCode === "PIN_INVALID")
        throw new UnauthorizedException({ code: "PIN_INVALID" });
      return replay;
    }
    let outcome;
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid FOR UPDATE`;
        const insideReplay = await tx.idempotencyRecord.findUnique({
          where: {
            scope_keyDigest: {
              scope: prepared.scope,
              keyDigest: prepared.keyDigest,
            },
          },
        });
        if (insideReplay) {
          const response = this.idempotency.assertCompatible(
            insideReplay,
            prepared,
          ) as Record<string, unknown>;
          return response.errorCode === "PIN_INVALID"
            ? { invalid: true as const }
            : { invalid: false as const, response };
        }
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: { fulfillment: true, assignments: true, deliveryTask: true },
        });
        if (!order?.fulfillment) throw new NotFoundException();
        await authorize(tx, order);
        const fulfillment = order.fulfillment;
        if (
          fulfillment.completionUsedAt ||
          fulfillment.completionExpiresAt <= new Date() ||
          fulfillment.completionAttempts >= this.env.pickupPinMaxAttempts
        ) {
          await tx.idempotencyRecord.create({
            data: this.idempotency.data(
              prepared,
              { errorCode: "PIN_INVALID" },
              401,
            ),
          });
          return { invalid: true as const };
        }
        if (
          !this.crypto.verifyPin(
            "completion",
            fulfillment.completionNonce,
            pin,
            fulfillment.completionPinDigest,
          )
        ) {
          await tx.orderFulfillment.update({
            where: { id: fulfillment.id },
            data: {
              completionAttempts: { increment: 1 },
              version: { increment: 1 },
            },
          });
          await tx.idempotencyRecord.create({
            data: this.idempotency.data(
              prepared,
              { errorCode: "PIN_INVALID" },
              401,
            ),
          });
          return { invalid: true as const };
        }
        await tx.orderFulfillment.update({
          where: { id: fulfillment.id },
          data: {
            status: "COMPLETED",
            completionUsedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (deliveryId)
          await tx.deliveryTask.update({
            where: { id: deliveryId },
            data: {
              status: "DELIVERED",
              active: false,
              completedAt: new Date(),
              version: { increment: 1 },
            },
          });
        const changed = await tx.order.updateMany({
          where: { id: orderId, version: order.version, status: order.status },
          data: { status: "COMPLETED", version: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw new ConflictException({ code: "ORDER_VERSION_CONFLICT" });
        const response = { orderId, orderStatus: "COMPLETED" };
        await tx.idempotencyRecord.create({
          data: this.idempotency.data(prepared, response),
        });
        await tx.outboxEvent.create({
          data: outbox("order", orderId, order.version + 1, "ORDER_COMPLETED"),
        });
        return { invalid: false as const, response };
      });
    } catch (error) {
      const recovered = await this.recoverIdempotencyRace(prepared, error);
      if (recovered) {
        if (recovered.errorCode === "PIN_INVALID")
          throw new UnauthorizedException({ code: "PIN_INVALID" });
        return recovered;
      }
      throw error;
    }
    if (outcome.invalid)
      throw new UnauthorizedException({ code: "PIN_INVALID" });
    await this.audit.record("ORDER_COMPLETED", actorId, "order", {
      status: "COMPLETED",
      operation: scope === "partner-pickup" ? "PICKUP" : "DELIVERY",
    });
    return outcome.response;
  }

  private async printJobDownload(agentId: string, jobId: string) {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, agentId },
      include: { order: { include: { printReadyVersion: true } } },
    });
    if (!job || !["LEASED", "PRINTING"].includes(job.status))
      throw new ConflictException({ code: "PRINT_JOB_NOT_CLAIMED" });
    return {
      jobId: job.id,
      status: job.status,
      documentUrl: await this.storage.signedGetUrl(
        job.order.printReadyVersion.objectKey,
        this.env.previewSignedUrlTtlSeconds,
      ),
      expiresInSeconds: this.env.previewSignedUrlTtlSeconds,
      leaseUntil: job.leaseUntil,
    };
  }

  private async failNoCourier(
    orderId: string,
    fulfillmentId: string,
    deliveryDedupKey: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid FOR UPDATE`;
      const prior = await tx.inboxOperation.findUnique({
        where: { dedupKey: deliveryDedupKey },
      });
      if (prior) return { duplicate: true };
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      if (order.status !== "AWAITING_PICKUP")
        throw new ConflictException({ code: "INVALID_DELIVERY_TRANSITION" });
      await tx.order.update({
        where: { id: orderId },
        data: { status: "DELIVERY_FAILED", version: { increment: 1 } },
      });
      await tx.orderFulfillment.update({
        where: { id: fulfillmentId },
        data: { status: "FAILED", version: { increment: 1 } },
      });
      await tx.inboxOperation.create({
        data: { dedupKey: deliveryDedupKey, operation: "ASSIGN_COURIER" },
      });
      await tx.outboxEvent.create({
        data: outbox("order", orderId, order.version + 1, "DELIVERY_FAILED"),
      });
      return { duplicate: false, noCourier: true };
    });
  }

  private async requireApprovedPartner(ownerId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { ownerId },
    });
    if (!partner || partner.status !== "APPROVED")
      throw new ForbiddenException();
    return partner;
  }

  private async requireApprovedCourier(userId: string) {
    const courier = await this.prisma.courierProfile.findUnique({
      where: { userId },
    });
    if (!courier || courier.status !== "APPROVED" || !courier.active)
      throw new ForbiddenException();
    return courier;
  }

  private courierView(courier: {
    id: string;
    displayName: string;
    serviceZone: string;
    status: string;
    active: boolean;
  }) {
    return {
      id: courier.id,
      displayName: courier.displayName,
      serviceZone: courier.serviceZone,
      status: courier.status,
      active: courier.active,
    };
  }

  private async recoverIdempotencyRace(
    prepared: ReturnType<IdempotencyService["prepare"]>,
    error: unknown,
  ): Promise<Record<string, unknown> | undefined> {
    const prismaError =
      error instanceof Prisma.PrismaClientKnownRequestError ? error : null;
    const retryable =
      prismaError?.code === "P2002" ||
      prismaError?.code === "P2034" ||
      (prismaError?.code === "P2010" &&
        typeof prismaError.meta === "object" &&
        prismaError.meta !== null &&
        "code" in prismaError.meta &&
        prismaError.meta.code === "40001");
    if (!retryable) return undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const recovered =
        await this.idempotency.replay<Record<string, unknown>>(prepared);
      if (recovered) return recovered;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new ConflictException({ code: "ORDER_VERSION_CONFLICT" });
  }
}
