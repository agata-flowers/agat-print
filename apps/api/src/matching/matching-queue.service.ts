import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import { CommerceService } from "../commerce/commerce.service";
import type { AppEnvironment } from "../config/environment";
import { PrismaService } from "../prisma/prisma.service";
import { APP_ENVIRONMENT } from "../uploads/private-object-storage.service";
import { MatchingService } from "./matching.service";
import { MockNotificationProvider } from "./mock-notification.provider";

interface MatchingPayload {
  eventType:
    | "PAYMENT_SUCCEEDED"
    | "PARTNER_OFFER_CREATED"
    | "MATCHING_EXHAUSTED";
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
export class MatchingQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue<MatchingPayload>;
  private worker?: Worker<MatchingPayload>;
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MatchingService) private readonly matching: MatchingService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(MockNotificationProvider)
    private readonly notifications: MockNotificationProvider,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {
    this.queue = new Queue("partner-matching", {
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
    if (!this.env.matchingDispatchEnabled) return;
    this.worker = new Worker("partner-matching", (job) => this.handle(job), {
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
        eventType: {
          in: [
            "PAYMENT_SUCCEEDED",
            "PARTNER_OFFER_CREATED",
            "MATCHING_EXHAUSTED",
          ],
        },
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    for (const event of events) {
      let delay = 0;
      if (event.eventType === "PARTNER_OFFER_CREATED") {
        const offer = await this.prisma.partnerOffer.findUnique({
          where: { id: event.aggregateId },
          include: { partner: true },
        });
        delay = Math.max(
          0,
          (offer?.expiresAt.getTime() ?? Date.now()) - Date.now(),
        );
        if (offer)
          await this.notifications.notify(
            offer.partner.ownerId,
            "PARTNER_OFFER",
            {
              idempotencyKey: event.dedupKey,
              correlationId: offer.id,
            },
          );
      }
      await this.queue.add(
        event.eventType,
        {
          eventType: event.eventType as MatchingPayload["eventType"],
          aggregateId: event.aggregateId,
          dedupKey: event.dedupKey,
        },
        { jobId: event.dedupKey, delay },
      );
      await this.prisma.outboxEvent.updateMany({
        where: { id: event.id, publishedAt: null },
        data: { publishedAt: new Date() },
      });
    }
    return events.length;
  }

  async handle(job: Job<MatchingPayload>) {
    const payload = job.data;
    if (!payload.aggregateId || !payload.dedupKey)
      throw new Error("Invalid matching payload");
    if (payload.eventType === "PAYMENT_SUCCEEDED")
      return this.matching.startByPaymentId(
        payload.aggregateId,
        payload.dedupKey,
      );
    if (payload.eventType === "PARTNER_OFFER_CREATED") {
      return this.matching.expireOffer(payload.aggregateId, payload.dedupKey);
    }
    if (payload.eventType === "MATCHING_EXHAUSTED")
      return this.commerce.requestNoExecutorRefund(
        undefined,
        payload.aggregateId,
        `stage6-no-executor-${payload.aggregateId}`,
        { syntheticEventReference: payload.aggregateId },
      );
    throw new Error("Unsupported matching operation");
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    await this.queue.close();
  }
}
