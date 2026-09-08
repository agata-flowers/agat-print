import { createHash, randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { Prisma, type OutboxEvent } from "@prisma/client";
import type { AppEnvironment } from "../config/environment";
import { PrismaService } from "../prisma/prisma.service";
import { APP_ENVIRONMENT } from "../uploads/private-object-storage.service";

const supportedEvents = [
  "ORDER_CREATED",
  "PAYMENT_SUCCEEDED",
  "PAYMENT_FAILED",
  "PARTNER_ASSIGNED",
  "ORDER_IN_PRODUCTION",
  "ORDER_READY",
  "DELIVERY_REQUESTED",
  "ORDER_IN_DELIVERY",
  "ORDER_COMPLETED",
  "DELIVERY_FAILED",
  "REFUND_CONFIRMED",
] as const;

const eventKeys: Record<string, { title: string; body: string }> = {
  ORDER_CREATED: { title: "order.created.title", body: "order.created.body" },
  PAYMENT_SUCCEEDED: { title: "order.updated.title", body: "order.paid.body" },
  PAYMENT_FAILED: {
    title: "order.attention.title",
    body: "order.payment_failed.body",
  },
  PARTNER_ASSIGNED: {
    title: "order.updated.title",
    body: "order.partner.body",
  },
  ORDER_IN_PRODUCTION: {
    title: "order.updated.title",
    body: "order.production.body",
  },
  ORDER_READY: { title: "order.ready.title", body: "order.ready.body" },
  DELIVERY_REQUESTED: {
    title: "order.updated.title",
    body: "order.delivery_requested.body",
  },
  ORDER_IN_DELIVERY: {
    title: "order.updated.title",
    body: "order.delivery.body",
  },
  ORDER_COMPLETED: {
    title: "order.completed.title",
    body: "order.completed.body",
  },
  DELIVERY_FAILED: {
    title: "order.attention.title",
    body: "order.delivery_failed.body",
  },
  REFUND_CONFIRMED: {
    title: "order.updated.title",
    body: "order.refunded.body",
  },
};

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

@Injectable()
export class NotificationWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private queue?: Queue<{ dedupKey: string }>;
  private worker?: Worker<{ dedupKey: string }>;
  private timer?: NodeJS.Timeout;
  private dispatching = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {}

  private connection() {
    const url = new URL(this.env.redisUrl);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    };
  }

  private getQueue() {
    return (this.queue ??= new Queue("customer-notifications", {
      connection: this.connection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 500,
        removeOnFail: 500,
      },
    }));
  }

  onModuleInit() {
    if (!this.env.orderingDispatchEnabled) return;
    this.getQueue();
    this.worker = new Worker(
      "customer-notifications",
      (job) => this.handle(job.data.dedupKey),
      { connection: this.connection(), concurrency: 2, lockDuration: 60_000 },
    );
    this.worker.on("error", () => undefined);
    this.timer = setInterval(() => void this.tick(), 1000);
    this.timer.unref();
  }

  private async tick() {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      await this.expireStaleDrafts();
      await this.dispatchBatch();
    } catch {
      /* durable retry on next tick */
    } finally {
      this.dispatching = false;
    }
  }

  async expireStaleDrafts(now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const drafts = await tx.orderDraft.findMany({
        where: {
          expiresAt: { lte: now },
          status: { notIn: ["CHECKED_OUT", "CANCELLED", "EXPIRED"] },
        },
        select: { id: true },
        take: 500,
      });
      const ids = drafts.map((draft) => draft.id);
      if (ids.length === 0) return 0;
      await tx.priceQuote.updateMany({
        where: { draftId: { in: ids }, status: "ACTIVE" },
        data: { status: "EXPIRED" },
      });
      await tx.orderDraft.updateMany({
        where: {
          id: { in: ids },
          status: { notIn: ["CHECKED_OUT", "CANCELLED", "EXPIRED"] },
        },
        data: { status: "EXPIRED", version: { increment: 1 } },
      });
      return ids.length;
    });
  }

  async dispatchBatch() {
    const events = await this.prisma.outboxEvent.findMany({
      where: { eventType: { in: [...supportedEvents] }, notificationJob: null },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    let count = 0;
    for (const event of events) {
      const dedupKey = digest(`customer-notification:${event.dedupKey}`);
      await this.prisma.notificationJob.upsert({
        where: { outboxEventId: event.id },
        create: { outboxEventId: event.id, dedupKey },
        update: {},
      });
      await this.getQueue().add(
        "CUSTOMER_NOTIFICATION",
        { dedupKey },
        { jobId: dedupKey },
      );
      count += 1;
    }
    return count;
  }

  async handle(dedupKey: string) {
    const claimed = await this.prisma.notificationJob.updateMany({
      where: {
        dedupKey,
        status: { in: ["PENDING", "PROCESSING"] },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: {
        status: "PROCESSING",
        leaseOwner: randomUUID(),
        leaseUntil: new Date(Date.now() + 60_000),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return { duplicate: true };
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const job = await tx.notificationJob.findUniqueOrThrow({
            where: { dedupKey },
            include: { outboxEvent: true },
          });
          const existing = await tx.inboxOperation.findUnique({
            where: { dedupKey },
          });
          if (existing) {
            await tx.notificationJob.update({
              where: { id: job.id },
              data: { status: "COMPLETED", leaseOwner: null, leaseUntil: null },
            });
            return { duplicate: true };
          }
          const order = await this.resolveOrder(tx, job.outboxEvent);
          if (!order) {
            await tx.inboxOperation.create({
              data: { dedupKey, operation: "CUSTOMER_NOTIFICATION" },
            });
            await tx.notificationJob.update({
              where: { id: job.id },
              data: { status: "COMPLETED", leaseOwner: null, leaseUntil: null },
            });
            return { ignored: true };
          }
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${order.id}))`;
          const aggregate = await tx.customerOrderEvent.aggregate({
            where: { orderId: order.id },
            _max: { sequence: true },
          });
          const keys = eventKeys[job.outboxEvent.eventType] ?? {
            title: "order.updated.title",
            body: "order.updated.body",
          };
          await tx.customerOrderEvent.upsert({
            where: { outboxEventId: job.outboxEvent.id },
            create: {
              orderId: order.id,
              outboxEventId: job.outboxEvent.id,
              sequence: (aggregate._max.sequence ?? 0) + 1,
              eventCode: job.outboxEvent.eventType,
            },
            update: {},
          });
          await tx.userNotification.upsert({
            where: {
              userId_outboxEventId: {
                userId: order.userId,
                outboxEventId: job.outboxEvent.id,
              },
            },
            create: {
              userId: order.userId,
              outboxEventId: job.outboxEvent.id,
              eventCode: job.outboxEvent.eventType,
              titleKey: keys.title,
              bodyKey: keys.body,
            },
            update: {},
          });
          await tx.inboxOperation.create({
            data: { dedupKey, operation: "CUSTOMER_NOTIFICATION" },
          });
          await tx.notificationJob.update({
            where: { id: job.id },
            data: {
              status: "COMPLETED",
              leaseOwner: null,
              leaseUntil: null,
              lastErrorCode: null,
            },
          });
          return { delivered: true };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const row = await this.prisma.notificationJob.findUnique({
        where: { dedupKey },
      });
      await this.prisma.notificationJob.updateMany({
        where: { dedupKey, status: "PROCESSING" },
        data: {
          status: (row?.attempts ?? 0) >= 5 ? "DEAD_LETTER" : "PENDING",
          leaseOwner: null,
          leaseUntil: null,
          lastErrorCode: "DELIVERY_RETRY",
        },
      });
      throw error;
    }
  }

  private async resolveOrder(tx: Prisma.TransactionClient, event: OutboxEvent) {
    if (event.aggregateType.toLowerCase() === "order")
      return tx.order.findUnique({
        where: { id: event.aggregateId },
        select: { id: true, userId: true },
      });
    if (event.aggregateType.toLowerCase() === "payment") {
      const payment = await tx.payment.findUnique({
        where: { id: event.aggregateId },
        select: { order: { select: { id: true, userId: true } } },
      });
      return payment?.order ?? null;
    }
    if (event.aggregateType.toLowerCase() === "refund") {
      const refund = await tx.refundOperation.findUnique({
        where: { id: event.aggregateId },
        select: {
          payment: {
            select: { order: { select: { id: true, userId: true } } },
          },
        },
      });
      return refund?.payment.order ?? null;
    }
    return null;
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    await this.queue?.close();
  }
}
