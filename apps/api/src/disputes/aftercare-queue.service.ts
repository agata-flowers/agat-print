import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { Prisma, type OutboxEvent } from "@prisma/client";
import type { AppEnvironment } from "../config/environment";
import { CommerceService } from "../commerce/commerce.service";
import { MockNotificationProvider } from "../matching/mock-notification.provider";
import { PrismaService } from "../prisma/prisma.service";
import { APP_ENVIRONMENT } from "../uploads/private-object-storage.service";
import { digest } from "./domain";
import { RetentionWorkerService } from "./retention-worker.service";

const eventTypes = [
  "AFTERCARE_REFUND_REQUESTED",
  "AFTERCARE_MOCK_REFUND_CALLBACK",
  "DISPUTE_OPENED",
  "DISPUTE_PARTNER_RESPONDED",
  "DISPUTE_RESOLVED",
  "DISPUTE_CANCELLED",
  "AFTERCARE_ORDER_CHANGED",
  "LEGAL_HOLD_CREATED",
  "LEGAL_HOLD_RELEASED",
  "ORDER_COMPLETED",
  "DELIVERY_FAILED",
  "REFUND_CONFIRMED",
  "RETENTION_SWEEP",
];

@Injectable()
export class AftercareQueueService implements OnModuleInit, OnModuleDestroy {
  private queue?: Queue<{ dedupKey: string }>;
  private worker?: Worker<{ dedupKey: string }>;
  private timer?: NodeJS.Timeout;
  private dispatching = false;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(RetentionWorkerService)
    private readonly retention: RetentionWorkerService,
    @Inject(MockNotificationProvider)
    private readonly notifications: MockNotificationProvider,
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
    return (this.queue ??= new Queue("aftercare", {
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
    if (!this.env.aftercareDispatchEnabled) return;
    this.getQueue();
    this.worker = new Worker(
      "aftercare",
      (job) => this.handle(job.data.dedupKey),
      { connection: this.connection(), concurrency: 2, lockDuration: 120000 },
    );
    this.worker.on("error", () => undefined);
    this.timer = setInterval(() => void this.tick(), 1000);
    this.timer.unref();
  }
  private async tick() {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const dedupKey = digest(
        "retention-sweep:" + Math.floor(Date.now() / 60000),
      );
      await this.prisma.outboxEvent.upsert({
        where: { dedupKey },
        create: {
          dedupKey,
          aggregateType: "retention",
          aggregateId: randomUUID(),
          aggregateVersion: 0,
          eventType: "RETENTION_SWEEP",
          payload: {},
        },
        update: {},
      });
      await this.dispatchBatch();
    } catch {
      /* Bounded retry next tick; no infrastructure error details are logged. */
    } finally {
      this.dispatching = false;
    }
  }

  async dispatchBatch() {
    await this.prisma.aftercareJob.updateMany({
      where: {
        attempts: { gte: 5 },
        OR: [
          { status: "PENDING" },
          { status: "RUNNING", leaseUntil: { lt: new Date() } },
        ],
      },
      data: {
        status: "DEAD_LETTER",
        leaseOwner: null,
        leaseUntil: null,
        lastErrorCode: "AFTERCARE_RETRY_LIMIT",
      },
    });
    // Database anti-join stays bounded even after years of completed jobs.
    const events = await this.prisma.$queryRaw<OutboxEvent[]>(Prisma.sql`
      SELECT e.* FROM "OutboxEvent" e
      WHERE e."eventType" IN (${Prisma.join(eventTypes)})
      AND NOT EXISTS (SELECT 1 FROM "AftercareJob" j WHERE j."dedupKey" = e."dedupKey"
        AND (j.status IN ('DONE', 'DEAD_LETTER') OR (j.status = 'RUNNING' AND j."leaseUntil" > now())))
      ORDER BY e."createdAt", e.id LIMIT 100
    `);
    for (const item of events) {
      await this.prisma.aftercareJob.upsert({
        where: { dedupKey: item.dedupKey },
        create: { dedupKey: item.dedupKey, eventId: item.id },
        update: {},
      });
      const queued = await this.getQueue().add(
        item.eventType,
        { dedupKey: item.dedupKey },
        { jobId: item.dedupKey },
      );
      // Redis can exhaust its retries before a database lease expires. The
      // durable attempt limit, not Redis history, determines retry eligibility.
      if ((await queued.getState()) === "failed") await queued.retry("failed");
      await this.prisma.outboxEvent.updateMany({
        where: { id: item.id, publishedAt: null },
        data: { publishedAt: new Date() },
      });
    }
    return events.length;
  }

  async handle(dedupKey: string) {
    const owner = randomUUID();
    const now = new Date();
    const claimed = await this.prisma.aftercareJob.updateMany({
      where: {
        dedupKey,
        attempts: { lt: 5 },
        OR: [
          { status: "PENDING" },
          { status: "RUNNING", leaseUntil: { lt: now } },
        ],
      },
      data: {
        status: "RUNNING",
        leaseOwner: owner,
        leaseUntil: new Date(now.getTime() + 120000),
        attempts: { increment: 1 },
      },
    });
    if (!claimed.count) {
      const prior = await this.prisma.aftercareJob.findUniqueOrThrow({
        where: { dedupKey },
      });
      if (prior.status === "DONE") return { duplicate: true };
      throw new Error(
        prior.status === "DEAD_LETTER"
          ? "AFTERCARE_MANUAL_REVIEW_REQUIRED"
          : "AFTERCARE_LEASE_UNAVAILABLE",
      );
    }
    const heartbeat = setInterval(() => {
      void this.prisma.aftercareJob
        .updateMany({
          where: { dedupKey, leaseOwner: owner, status: "RUNNING" },
          data: { leaseUntil: new Date(Date.now() + 120000) },
        })
        .catch(() => undefined);
    }, 30000);
    heartbeat.unref();
    try {
      const job = await this.prisma.aftercareJob.findUniqueOrThrow({
        where: { dedupKey },
      });
      const item = await this.prisma.outboxEvent.findUniqueOrThrow({
        where: { id: job.eventId },
      });
      if (item.eventType === "AFTERCARE_REFUND_REQUESTED")
        await this.commerce.dispatchRefundOperation(item.aggregateId);
      else if (item.eventType === "AFTERCARE_MOCK_REFUND_CALLBACK")
        await this.commerce.confirmMockRefund(item.aggregateId);
      else if (item.eventType === "RETENTION_SWEEP") await this.retention.run();
      else {
        if (item.aggregateType === "dispute") {
          const dispute = await this.prisma.disputeCase.findUniqueOrThrow({
            where: { id: item.aggregateId },
            include: {
              order: {
                include: { assignments: { include: { partner: true } } },
              },
            },
          });
          for (const userId of new Set([
            dispute.openedById,
            ...dispute.order.assignments.map((a) => a.partner.ownerId),
          ]))
            await this.notifications.notify(userId, item.eventType, {
              idempotencyKey: digest(dedupKey + userId),
              correlationId: randomUUID(),
            });
          await this.retention.reconcileOrder(dispute.orderId);
        } else if (item.aggregateType === "order")
          await this.retention.reconcileOrder(item.aggregateId);
        else if (item.aggregateType === "payment") {
          const payment = await this.prisma.payment.findUniqueOrThrow({
            where: { id: item.aggregateId },
          });
          await this.retention.reconcileOrder(payment.orderId);
        } else if (item.aggregateType === "hold") {
          const hold = await this.prisma.legalHold.findUniqueOrThrow({
            where: { id: item.aggregateId },
          });
          await this.retention.reconcileOrder(hold.orderId);
        }
      }
      await this.prisma.$transaction(async (tx) => {
        const saved = await tx.aftercareJob.updateMany({
          where: { dedupKey, leaseOwner: owner, status: "RUNNING" },
          data: {
            status: "DONE",
            completedAt: new Date(),
            leaseUntil: null,
            leaseOwner: null,
          },
        });
        if (saved.count !== 1) throw new Error("AFTERCARE_LEASE_LOST");
        await tx.inboxOperation.upsert({
          where: { dedupKey },
          create: { dedupKey, operation: "AFTERCARE" },
          update: {},
        });
      });
      return { duplicate: false };
    } catch {
      const job = await this.prisma.aftercareJob.findUniqueOrThrow({
        where: { dedupKey },
      });
      await this.prisma.aftercareJob.updateMany({
        where: { dedupKey, leaseOwner: owner },
        data: {
          status: job.attempts >= 5 ? "DEAD_LETTER" : "PENDING",
          leaseOwner: null,
          leaseUntil: null,
          lastErrorCode: "AFTERCARE_OPERATION_FAILED",
        },
      });
      throw new Error("AFTERCARE_OPERATION_FAILED");
    } finally {
      clearInterval(heartbeat);
    }
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    await this.queue?.close();
  }
}
