import { createHash, randomUUID } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type PaymentStatus } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import type { AppEnvironment } from "../config/environment";
import { PrismaService } from "../prisma/prisma.service";
import { APP_ENVIRONMENT } from "../uploads/private-object-storage.service";
import type {
  CreateOrderDto,
  CreateTariffDto,
  NoExecutorRefundDto,
  PaymentCallbackDto,
  StartPaymentDto,
} from "./dto";
import { IdempotencyService } from "./idempotency.service";
import { MockPaymentProvider } from "./mock-payment.provider";

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

const tariffView = (tariff: {
  id: string;
  version: number;
  status: string;
  currency: string;
  basePriceMinor: bigint;
  perPagePriceMinor: bigint;
  createdAt: Date;
}) => ({
  id: tariff.id,
  version: tariff.version,
  status: tariff.status,
  currency: tariff.currency,
  basePriceMinor: tariff.basePriceMinor.toString(),
  perPagePriceMinor: tariff.perPagePriceMinor.toString(),
  createdAt: tariff.createdAt,
});

const orderInclude = {
  priceSnapshot: true,
  payment: {
    include: { refunds: { orderBy: { createdAt: "desc" as const } } },
  },
  productionCycles: { orderBy: { sequence: "desc" as const }, take: 1 },
  fulfillments: { orderBy: { createdAt: "desc" as const }, take: 1 },
  deliveryTasks: { orderBy: { assignedAt: "desc" as const }, take: 1 },
} satisfies Prisma.OrderInclude;

type OrderWithFinance = Prisma.OrderGetPayload<{
  include: typeof orderInclude;
}>;

const orderView = (order: OrderWithFinance) => ({
  id: order.id,
  layoutId: order.layoutId,
  layoutApprovalId: order.layoutApprovalId,
  printReadyVersionId: order.printReadyVersionId,
  status: order.status,
  version: order.version,
  createdAt: order.createdAt,
  price: order.priceSnapshot
    ? {
        tariffVersion: order.priceSnapshot.tariffVersion,
        sourceParameters: order.priceSnapshot.sourceParameters,
        lineItems: order.priceSnapshot.lineItems,
        quantity: order.priceSnapshot.quantity,
        subtotalMinor: order.priceSnapshot.subtotalMinor.toString(),
        discountMinor: order.priceSnapshot.discountMinor.toString(),
        totalMinor: order.priceSnapshot.totalMinor.toString(),
        currency: order.priceSnapshot.currency,
      }
    : null,
  payment: order.payment
    ? {
        status: order.payment.status,
        amountMinor: order.payment.amountMinor.toString(),
        currency: order.payment.currency,
        refundStatus: order.payment.refunds[0]?.status ?? null,
      }
    : null,
  fulfillment:
    order.fulfillments[0] &&
    order.fulfillments[0].productionCycleId === order.productionCycles[0]?.id
      ? {
          mode: order.fulfillments[0].mode,
          status: order.fulfillments[0].status,
          expiresAt: order.fulfillments[0].completionExpiresAt,
          deliveryStatus: order.deliveryTasks[0]?.status ?? null,
        }
      : null,
});

@Injectable()
export class CommerceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(MockPaymentProvider) private readonly payments: MockPaymentProvider,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {}

  async createTariff(actorId: string, input: CreateTariffDto) {
    const base = BigInt(input.basePriceMinor);
    const perPage = BigInt(input.perPagePriceMinor);
    if (base + perPage <= 0n)
      throw new ConflictException({ code: "EMPTY_TARIFF" });
    const tariff = await this.prisma.$transaction(
      async (tx) => {
        const current = await tx.tariffVersion.findFirst({
          orderBy: { version: "desc" },
        });
        if (current?.status === "ACTIVE")
          await tx.tariffVersion.update({
            where: { id: current.id },
            data: { status: "RETIRED", retiredAt: new Date() },
          });
        const created = await tx.tariffVersion.create({
          data: {
            version: (current?.version ?? 0) + 1,
            basePriceMinor: base,
            perPagePriceMinor: perPage,
            createdById: actorId,
          },
        });
        await tx.outboxEvent.create({
          data: outbox(
            "tariff",
            created.id,
            created.version,
            "TARIFF_ACTIVATED",
          ),
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.audit.record("TARIFF_VERSION_CREATED", actorId, "tariff", {
      status: "ACTIVE",
      operation: "CREATE",
    });
    return tariffView(tariff);
  }

  async tariffs() {
    return (
      await this.prisma.tariffVersion.findMany({ orderBy: { version: "desc" } })
    ).map(tariffView);
  }

  async currentTariff() {
    const tariff = await this.prisma.tariffVersion.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { version: "desc" },
    });
    if (!tariff) throw new NotFoundException({ code: "NO_ACTIVE_TARIFF" });
    return tariffView(tariff);
  }

  async createOrder(
    userId: string,
    key: string | undefined,
    input: CreateOrderDto,
  ) {
    const prepared = this.idempotency.prepare(
      `order:create:${userId}`,
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<ReturnType<typeof orderView>>(prepared);
    if (replay) return replay;
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const approval = await tx.layoutApproval.findFirst({
            where: { id: input.layoutApprovalId, userId },
            include: {
              layout: { include: { upload: true } },
              previewVersion: true,
            },
          });
          if (!approval) throw new NotFoundException();
          const layout = approval.layout;
          if (
            layout.status !== "APPROVED" ||
            layout.currentApprovalId !== approval.id ||
            layout.latestPreviewId !== approval.previewVersionId ||
            !layout.latestPrintReadyId ||
            layout.version !== approval.layoutVersion + 1 ||
            approval.previewVersion.sourceFileVersion !==
              layout.sourceFileVersion ||
            approval.previewVersion.settingsHash !== layout.settingsHash
          )
            throw new ConflictException({
              code: "LAYOUT_APPROVAL_NOT_CURRENT",
            });
          const printReady = await tx.printReadyVersion.findFirst({
            where: {
              id: layout.latestPrintReadyId,
              layoutId: layout.id,
              sourceFileVersion: layout.sourceFileVersion,
              settingsHash: layout.settingsHash,
            },
          });
          if (!printReady)
            throw new ConflictException({ code: "PRINT_READY_NOT_CURRENT" });
          const tariff = await tx.tariffVersion.findFirst({
            where: { status: "ACTIVE" },
            orderBy: { version: "desc" },
          });
          if (!tariff)
            throw new ConflictException({ code: "NO_ACTIVE_TARIFF" });
          const pageUnits = BigInt(printReady.pageCount * input.quantity);
          const pageTotal = tariff.perPagePriceMinor * pageUnits;
          const subtotal = tariff.basePriceMinor + pageTotal;
          const created = await tx.order.create({
            data: {
              userId,
              layoutId: layout.id,
              layoutApprovalId: approval.id,
              printReadyVersionId: printReady.id,
              priceSnapshot: {
                create: {
                  tariffVersionId: tariff.id,
                  tariffVersion: tariff.version,
                  sourceParameters: {
                    fileKind: layout.upload.fileKind,
                    pageCount: printReady.pageCount,
                    layoutSettings: layout.settings,
                  },
                  lineItems: [
                    {
                      code: "BASE",
                      quantity: 1,
                      unitPriceMinor: tariff.basePriceMinor.toString(),
                      totalMinor: tariff.basePriceMinor.toString(),
                    },
                    {
                      code: "PAGE",
                      quantity: pageUnits.toString(),
                      unitPriceMinor: tariff.perPagePriceMinor.toString(),
                      totalMinor: pageTotal.toString(),
                    },
                  ],
                  quantity: input.quantity,
                  subtotalMinor: subtotal,
                  discountMinor: 0n,
                  totalMinor: subtotal,
                  currency: "UZS",
                },
              },
            },
            include: orderInclude,
          });
          await tx.outboxEvent.create({
            data: outbox("order", created.id, created.version, "ORDER_CREATED"),
          });
          const response = orderView(created);
          await tx.idempotencyRecord.create({
            data: this.idempotency.data(
              prepared,
              response as unknown as Prisma.InputJsonValue,
              201,
            ),
          });
          return response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      await this.audit.record("ORDER_CREATED", userId, "order", {
        status: "AWAITING_PAYMENT",
      });
      return result;
    } catch (error) {
      return this.handleIdempotencyRace(error, prepared);
    }
  }

  async ownOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException();
    return orderView(order);
  }

  async startPayment(
    userId: string,
    orderId: string,
    key: string | undefined,
    input: StartPaymentDto,
  ) {
    if (this.env.paymentProvider !== "mock")
      throw new ConflictException({ code: "PAYMENT_PROVIDER_UNAVAILABLE" });
    const prepared = this.idempotency.prepare(
      `payment:start:${orderId}`,
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException();
    if (order.status !== "AWAITING_PAYMENT" || !order.priceSnapshot)
      throw new ConflictException({ code: "ORDER_NOT_PAYABLE" });
    if (order.payment?.status === "SUCCEEDED")
      throw new ConflictException({ code: "PAYMENT_ALREADY_SUCCEEDED" });
    const provider = await this.payments.start(
      order.id,
      order.priceSnapshot.totalMinor,
      "UZS",
      { idempotencyKey: prepared.keyDigest, correlationId: order.id },
    );
    const callback: PaymentCallbackDto = {
      eventId: randomUUID(),
      paymentReference: provider.reference,
      outcome:
        input.simulateOutcome === "SUCCESS"
          ? "PAYMENT_SUCCEEDED"
          : "PAYMENT_FAILED",
    };
    const callbackBody = JSON.stringify(callback);
    try {
      const response = await this.prisma.$transaction(async (tx) => {
        const payment = order.payment
          ? await tx.payment.update({
              where: { id: order.payment.id },
              data: {
                providerPaymentReference: provider.reference,
                status: "PENDING",
                version: { increment: 1 },
              },
            })
          : await tx.payment.create({
              data: {
                orderId: order.id,
                provider: "mock",
                providerPaymentReference: provider.reference,
                amountMinor: order.priceSnapshot!.totalMinor,
                currency: "UZS",
              },
            });
        await tx.outboxEvent.create({
          data: outbox(
            "payment",
            payment.id,
            payment.version,
            "PAYMENT_STARTED",
          ),
        });
        const value = {
          orderId: order.id,
          paymentStatus: payment.status,
          mockCallback: callback,
          mockSignature: this.payments.sign(callbackBody),
        };
        await tx.idempotencyRecord.create({
          data: this.idempotency.data(
            prepared,
            value as unknown as Prisma.InputJsonValue,
          ),
        });
        return value;
      });
      await this.audit.record("PAYMENT_STARTED", userId, "payment", {
        status: "PENDING",
        operation: "PAY",
      });
      return response;
    } catch (error) {
      return this.handleIdempotencyRace(error, prepared);
    }
  }

  async callback(input: PaymentCallbackDto, signature: string | undefined) {
    const raw = JSON.stringify(input);
    if (!this.payments.verify(raw, signature))
      throw new ForbiddenException({ code: "INVALID_PROVIDER_SIGNATURE" });
    const payloadHash = digest(raw);
    const existing = await this.prisma.providerCallback.findUnique({
      where: { provider_eventId: { provider: "mock", eventId: input.eventId } },
    });
    if (existing) {
      if (existing.payloadHash !== payloadHash)
        throw new ConflictException({ code: "CALLBACK_REPLAY_CONFLICT" });
      return existing.result;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const located = await tx.payment.findFirst({
          where: {
            OR: [
              { providerPaymentReference: input.paymentReference },
              {
                refunds: {
                  some: { providerRefundReference: input.paymentReference },
                },
              },
            ],
          },
          include: { order: true, refunds: true },
        });
        if (!located) throw new NotFoundException();
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${located.orderId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${located.id}::uuid FOR UPDATE`;
        const prior = await tx.providerCallback.findUnique({
          where: {
            provider_eventId: { provider: "mock", eventId: input.eventId },
          },
        });
        if (prior) {
          if (prior.payloadHash !== payloadHash)
            throw new ConflictException({ code: "CALLBACK_REPLAY_CONFLICT" });
          return prior.result;
        }
        const payment = await tx.payment.findUniqueOrThrow({
          where: { id: located.id },
          include: { order: true, refunds: true },
        });
        if (
          input.outcome !== "REFUND_SUCCEEDED" &&
          payment.providerPaymentReference !== input.paymentReference
        )
          throw new ConflictException({ code: "INVALID_PAYMENT_REFERENCE" });
        let paymentStatus: PaymentStatus;
        let orderStatus:
          | "AWAITING_PAYMENT"
          | "PAID"
          | "REFUND_PENDING"
          | "PARTIALLY_REFUNDED"
          | "REFUNDED";
        let eventType: string;
        if (input.outcome === "PAYMENT_SUCCEEDED") {
          if (payment.status === "SUCCEEDED" && payment.order.status === "PAID")
            return this.storeRepeatedCallback(tx, input, payloadHash, payment);
          if (
            payment.status !== "PENDING" ||
            payment.order.status !== "AWAITING_PAYMENT"
          )
            throw new ConflictException({ code: "INVALID_PAYMENT_TRANSITION" });
          paymentStatus = "SUCCEEDED";
          orderStatus = "PAID";
          eventType = "PAYMENT_SUCCEEDED";
        } else if (input.outcome === "PAYMENT_FAILED") {
          if (payment.status === "FAILED")
            return this.storeRepeatedCallback(tx, input, payloadHash, payment);
          if (
            payment.status !== "PENDING" ||
            payment.order.status !== "AWAITING_PAYMENT"
          )
            throw new ConflictException({ code: "INVALID_PAYMENT_TRANSITION" });
          paymentStatus = "FAILED";
          orderStatus = "AWAITING_PAYMENT";
          eventType = "PAYMENT_FAILED";
        } else {
          const refund = payment.refunds.find(
            (item) => item.providerRefundReference === input.paymentReference,
          );
          if (refund?.status === "CONFIRMED")
            return this.storeRepeatedCallback(tx, input, payloadHash, payment);
          if (
            !refund ||
            refund.providerRefundReference !== input.paymentReference ||
            payment.status !== "REFUND_PENDING" ||
            payment.order.status !== "REFUND_PENDING"
          )
            throw new ConflictException({ code: "INVALID_REFUND_TRANSITION" });
          const confirmedTotal =
            payment.refunds
              .filter((item) => item.status === "CONFIRMED")
              .reduce((sum, item) => sum + item.amountMinor, 0n) +
            refund.amountMinor;
          const fullyRefunded = confirmedTotal >= payment.amountMinor;
          paymentStatus = fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED";
          orderStatus = fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED";
          eventType = "REFUND_CONFIRMED";
          await tx.refundOperation.update({
            where: { id: refund.id },
            data: { status: "CONFIRMED", confirmedAt: new Date() },
          });
        }
        const changedPayment = await tx.payment.update({
          where: {
            id: payment.id,
            version: payment.version,
            status: payment.status,
          },
          data: { status: paymentStatus, version: { increment: 1 } },
        });
        const changedOrder = await tx.order.update({
          where: {
            id: payment.orderId,
            version: payment.order.version,
            status: payment.order.status,
          },
          data: { status: orderStatus, version: { increment: 1 } },
        });
        await tx.outboxEvent.create({
          data: outbox(
            "payment",
            payment.id,
            changedPayment.version,
            eventType,
          ),
        });
        const result = {
          accepted: true,
          paymentStatus: changedPayment.status,
          orderStatus: changedOrder.status,
        };
        await tx.providerCallback.create({
          data: {
            provider: "mock",
            eventId: input.eventId,
            payloadHash,
            result,
          },
        });
        return result;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const replay = await this.prisma.providerCallback.findUniqueOrThrow({
          where: {
            provider_eventId: { provider: "mock", eventId: input.eventId },
          },
        });
        if (replay.payloadHash !== payloadHash)
          throw new ConflictException({ code: "CALLBACK_REPLAY_CONFLICT" });
        return replay.result;
      }
      throw error;
    }
  }

  async requestNoExecutorRefund(
    actorId: string | undefined,
    orderId: string,
    key: string | undefined,
    input: NoExecutorRefundDto,
  ) {
    const prepared = this.idempotency.prepare(
      `refund:no-executor:${orderId}`,
      key,
      input,
    );
    const replay =
      await this.idempotency.replay<Record<string, unknown>>(prepared);
    if (replay) return replay;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: orderInclude,
    });
    const triggerDedupKey = digest(
      `NO_EXECUTOR:${input.syntheticEventReference}`,
    );
    const priorRefund = await this.prisma.refundOperation.findUnique({
      where: { triggerDedupKey },
      include: { payment: { include: { order: true } } },
    });
    if (priorRefund) {
      if (priorRefund.payment.orderId !== orderId)
        throw new ConflictException({ code: "REFUND_EVENT_CONFLICT" });
      return {
        orderId,
        orderStatus: priorRefund.payment.order.status,
        paymentStatus: priorRefund.payment.status,
        refundStatus: priorRefund.status,
      };
    }
    if (
      !order?.payment ||
      order.payment.status !== "SUCCEEDED" ||
      !["PAID", "MATCHING", "PARTNER_OFFERED"].includes(order.status)
    )
      throw new ConflictException({ code: "ORDER_NOT_REFUNDABLE" });
    const provider = await this.payments.refund(
      order.payment.providerPaymentReference!,
      order.payment.amountMinor,
      { idempotencyKey: triggerDedupKey, correlationId: order.id },
    );
    try {
      const response = await this.prisma.$transaction(async (tx) => {
        const refund = await tx.refundOperation.create({
          data: {
            paymentId: order.payment!.id,
            triggerDedupKey,
            providerRefundReference: provider.reference,
            amountMinor: order.payment!.amountMinor,
          },
        });
        const payment = await tx.payment.update({
          where: { id: order.payment!.id },
          data: { status: "REFUND_PENDING", version: { increment: 1 } },
        });
        const changedOrder = await tx.order.update({
          where: { id: order.id },
          data: { status: "REFUND_PENDING", version: { increment: 1 } },
        });
        await tx.outboxEvent.create({
          data: outbox(
            "payment",
            payment.id,
            payment.version,
            "REFUND_REQUESTED",
          ),
        });
        const callback: PaymentCallbackDto = {
          eventId: randomUUID(),
          paymentReference: provider.reference,
          outcome: "REFUND_SUCCEEDED",
        };
        const value = {
          orderId: order.id,
          orderStatus: changedOrder.status,
          paymentStatus: payment.status,
          refundStatus: refund.status,
          mockCallback: callback,
          mockSignature: this.payments.sign(JSON.stringify(callback)),
        };
        await tx.idempotencyRecord.create({
          data: this.idempotency.data(
            prepared,
            value as unknown as Prisma.InputJsonValue,
          ),
        });
        return value;
      });
      await this.audit.record("REFUND_REQUESTED", actorId, "payment", {
        status: "REFUND_PENDING",
        operation: "NO_EXECUTOR",
      });
      return response;
    } catch (error) {
      return this.handleIdempotencyRace(error, prepared);
    }
  }

  async financeAudit() {
    return this.prisma.auditEvent.findMany({
      where: {
        eventType: {
          in: [
            "TARIFF_VERSION_CREATED",
            "ORDER_CREATED",
            "PAYMENT_STARTED",
            "REFUND_REQUESTED",
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        eventType: true,
        targetType: true,
        metadata: true,
        createdAt: true,
      },
    });
  }

  async dispatchRefundOperation(operationId: string) {
    const operation = await this.prisma.refundOperation.findUnique({
      where: { id: operationId },
      include: { payment: true },
    });
    if (!operation) throw new NotFoundException();
    if (!operation.payment.providerPaymentReference)
      throw new ConflictException({ code: "PAYMENT_REFERENCE_MISSING" });
    const provider = operation.providerRefundReference
      ? { reference: operation.providerRefundReference }
      : await this.payments.refund(
          operation.payment.providerPaymentReference,
          operation.amountMinor,
          {
            idempotencyKey: operation.triggerDedupKey,
            correlationId: operation.paymentId,
          },
        );
    await this.prisma.$transaction(async (tx) => {
      await tx.refundOperation.updateMany({
        where: { id: operation.id, providerRefundReference: null },
        data: { providerRefundReference: provider.reference },
      });
      const next = outbox(
        "refund",
        operation.id,
        1,
        "AFTERCARE_MOCK_REFUND_CALLBACK",
      );
      await tx.outboxEvent.upsert({
        where: { dedupKey: next.dedupKey },
        create: next,
        update: {},
      });
    });
    return { dispatched: true };
  }

  async confirmMockRefund(operationId: string) {
    if (
      this.env.nodeEnv === "production" ||
      this.env.paymentProvider !== "mock"
    )
      throw new ForbiddenException({ code: "MOCK_PROVIDER_FORBIDDEN" });
    const refund = await this.prisma.refundOperation.findUniqueOrThrow({
      where: { id: operationId },
    });
    if (!refund.providerRefundReference)
      throw new ConflictException({ code: "REFUND_NOT_DISPATCHED" });
    const input: PaymentCallbackDto = {
      eventId: operationId,
      paymentReference: refund.providerRefundReference,
      outcome: "REFUND_SUCCEEDED",
    };
    return this.callback(input, this.payments.sign(JSON.stringify(input)));
  }

  private async handleIdempotencyRace(
    error: unknown,
    prepared: ReturnType<IdempotencyService["prepare"]>,
  ): Promise<unknown> {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2034"].includes(error.code)
    ) {
      const existing = await this.prisma.idempotencyRecord.findUnique({
        where: {
          scope_keyDigest: {
            scope: prepared.scope,
            keyDigest: prepared.keyDigest,
          },
        },
      });
      if (existing)
        return this.idempotency.assertCompatible(existing, prepared);
    }
    throw error;
  }

  private async storeRepeatedCallback(
    tx: Prisma.TransactionClient,
    input: PaymentCallbackDto,
    payloadHash: string,
    payment: { status: PaymentStatus; order: { status: string } },
  ) {
    const result = {
      accepted: true,
      paymentStatus: payment.status,
      orderStatus: payment.order.status,
    };
    await tx.providerCallback.create({
      data: {
        provider: "mock",
        eventId: input.eventId,
        payloadHash,
        result,
      },
    });
    return result;
  }
}
