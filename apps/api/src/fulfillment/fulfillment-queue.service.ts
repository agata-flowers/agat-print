import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { AppEnvironment } from "../config/environment";
import { PrismaService } from "../prisma/prisma.service";
import { APP_ENVIRONMENT } from "../uploads/private-object-storage.service";
import { FulfillmentService } from "./fulfillment.service";

interface FulfillmentPayload {
  eventType: "PARTNER_ASSIGNED" | "DELIVERY_REQUESTED";
  aggregateId: string;
  dedupKey: string;
}

const connection = (redisUrl: string) => {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.pathname.length > 1 ? { db: Number(url.pathname.slice(1)) } : {}),
  };
};

@Injectable()
export class FulfillmentQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue<FulfillmentPayload>;
  private worker?: Worker<FulfillmentPayload>;
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FulfillmentService)
    private readonly fulfillment: FulfillmentService,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {
    this.queue = new Queue("order-fulfillment", {
      connection: connection(env.redisUrl),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: 500,
        removeOnFail: 500,
      },
    });
  }

  onModuleInit() {
    if (!this.env.fulfillmentDispatchEnabled) return;
    this.worker = new Worker("order-fulfillment", (job) => this.handle(job), {
      connection: connection(this.env.redisUrl),
      concurrency: 2,
    });
    this.timer = setInterval(
      () => void this.dispatchBatch().catch(() => undefined),
      1_000,
    );
    this.timer.unref();
  }

  async dispatchBatch() {
    const events = await this.prisma.outboxEvent.findMany({
      where: {
        publishedAt: null,
        eventType: { in: ["PARTNER_ASSIGNED", "DELIVERY_REQUESTED"] },
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    for (const event of events) {
      await this.queue.add(
        event.eventType,
        {
          eventType: event.eventType as FulfillmentPayload["eventType"],
          aggregateId: event.aggregateId,
          dedupKey: event.dedupKey,
        },
        { jobId: event.dedupKey },
      );
      await this.prisma.outboxEvent.updateMany({
        where: { id: event.id, publishedAt: null },
        data: { publishedAt: new Date() },
      });
    }
    return events.length;
  }

  handle(job: Job<FulfillmentPayload>) {
    const payload = job.data;
    if (payload.eventType === "PARTNER_ASSIGNED")
      return this.fulfillment.createPrintJob(
        payload.aggregateId,
        payload.dedupKey,
      );
    if (payload.eventType === "DELIVERY_REQUESTED")
      return this.fulfillment.assignDelivery(
        payload.aggregateId,
        payload.dedupKey,
      );
    throw new Error("Unsupported fulfillment operation");
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    await this.queue.close();
  }
}
