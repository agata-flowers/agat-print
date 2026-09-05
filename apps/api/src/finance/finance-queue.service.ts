import { createHash, randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Prisma, type OutboxEvent } from "@prisma/client";
import { Queue, Worker } from "bullmq";
import type { AppEnvironment } from "../config/environment";
import { PrismaService } from "../prisma/prisma.service";
import { APP_ENVIRONMENT } from "../uploads/private-object-storage.service";
import { FinanceService } from "./finance.service";

const eventTypes = [
  "PAYMENT_SUCCEEDED",
  "REFUND_CONFIRMED",
  "ORDER_COMPLETED",
  "FISCAL_SUBMIT_REQUESTED",
];
const inboxKey = (dedupKey: string) =>
  createHash("sha256").update(`finance:${dedupKey}`).digest("hex");

@Injectable()
export class FinanceQueueService implements OnModuleInit, OnModuleDestroy {
  private queue?: Queue<{ dedupKey: string }>;
  private worker?: Worker<{ dedupKey: string }>;
  private timer?: NodeJS.Timeout;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinanceService) private readonly finance: FinanceService,
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
    return (this.queue ??= new Queue("financial-operations", {
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
    if (!this.env.financeDispatchEnabled) return;
    this.getQueue();
    this.worker = new Worker(
      "financial-operations",
      (job) => this.handle(job.data.dedupKey),
      {
        connection: this.connection(),
        concurrency: 2,
        lockDuration: 120000,
      },
    );
    this.worker.on("error", () => undefined);
    this.timer = setInterval(
      () => void this.dispatchBatch().catch(() => undefined),
      1000,
    );
    this.timer.unref();
  }
  async dispatchBatch() {
    const events = await this.prisma.$queryRaw<OutboxEvent[]>(Prisma.sql`
      SELECT e.* FROM "OutboxEvent" e
      WHERE e."eventType" IN (${Prisma.join(eventTypes)})
      AND NOT EXISTS (SELECT 1 FROM "FinancialJob" j WHERE j."dedupKey" = e."dedupKey"
        AND (j.status IN ('DONE', 'DEAD_LETTER') OR (j.status = 'RUNNING' AND j."leaseUntil" > now())))
      ORDER BY e."createdAt", e.id LIMIT 100
    `);
    for (const event of events) {
      await this.prisma.financialJob.upsert({
        where: { dedupKey: event.dedupKey },
        create: { dedupKey: event.dedupKey, eventId: event.id },
        update: {},
      });
      const job = await this.getQueue().add(
        event.eventType,
        { dedupKey: event.dedupKey },
        { jobId: event.dedupKey },
      );
      if ((await job.getState()) === "failed") await job.retry("failed");
    }
    return events.length;
  }
  async handle(dedupKey: string) {
    const leaseOwner = randomUUID();
    const claimed = await this.prisma.financialJob.updateMany({
      where: {
        dedupKey,
        attempts: { lt: 5 },
        OR: [
          { status: "PENDING" },
          { status: "RUNNING", leaseUntil: { lt: new Date() } },
        ],
      },
      data: {
        status: "RUNNING",
        attempts: { increment: 1 },
        leaseOwner,
        leaseUntil: new Date(Date.now() + 120000),
      },
    });
    if (!claimed.count) {
      const prior = await this.prisma.financialJob.findUniqueOrThrow({
        where: { dedupKey },
      });
      if (prior.status === "DONE") return { duplicate: true };
      throw new Error("FINANCIAL_JOB_LEASE_UNAVAILABLE");
    }
    try {
      const job = await this.prisma.financialJob.findUniqueOrThrow({
        where: { dedupKey },
      });
      const event = await this.prisma.outboxEvent.findUniqueOrThrow({
        where: { id: job.eventId },
      });
      if (event.eventType === "FISCAL_SUBMIT_REQUESTED")
        await this.finance.dispatchFiscal(event.aggregateId);
      else await this.finance.materializeEvent(event.id);
      await this.prisma.$transaction(async (tx) => {
        const saved = await tx.financialJob.updateMany({
          where: { dedupKey, leaseOwner, status: "RUNNING" },
          data: {
            status: "DONE",
            completedAt: new Date(),
            leaseOwner: null,
            leaseUntil: null,
          },
        });
        if (saved.count !== 1) throw new Error("FINANCIAL_JOB_LEASE_LOST");
        const financeInboxKey = inboxKey(dedupKey);
        await tx.inboxOperation.upsert({
          where: { dedupKey: financeInboxKey },
          create: { dedupKey: financeInboxKey, operation: "FINANCE" },
          update: {},
        });
      });
      return { duplicate: false };
    } catch {
      const job = await this.prisma.financialJob.findUniqueOrThrow({
        where: { dedupKey },
      });
      await this.prisma.financialJob.updateMany({
        where: { dedupKey, leaseOwner },
        data: {
          status: job.attempts >= 5 ? "DEAD_LETTER" : "PENDING",
          leaseOwner: null,
          leaseUntil: null,
          lastErrorCode: "FINANCIAL_OPERATION_FAILED",
        },
      });
      throw new Error("FINANCIAL_OPERATION_FAILED");
    }
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    await this.queue?.close();
  }
}
