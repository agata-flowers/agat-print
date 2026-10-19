import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Queue } from "bullmq";
import type { AppEnvironment } from "../config/environment";
import { PrismaService } from "../prisma/prisma.service";
import { APP_ENVIRONMENT } from "./private-object-storage.service";

const connectionOptions = (redisUrl: string) => {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.pathname.length > 1 ? { db: Number(url.pathname.slice(1)) } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
};

@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly fileQueue: Queue;
  private readonly layoutQueue: Queue;
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {
    const options = {
      connection: connectionOptions(env.redisUrl),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential" as const, delay: 1_000 },
        removeOnComplete: 500,
        removeOnFail: 500,
      },
    };
    this.fileQueue = new Queue("file-processing", options);
    this.layoutQueue = new Queue("layout-processing", options);
  }

  onModuleInit(): void {
    if (!this.env.processingDispatchEnabled) return;
    this.timer = setInterval(() => {
      void this.dispatchBatch().catch(() => undefined);
    }, 1_000);
    this.timer.unref();
  }

  async dispatchBatch(): Promise<number> {
    const events = await this.prisma.outboxEvent.findMany({
      where: {
        publishedAt: null,
        eventType: {
          in: ["FILE_PROCESSING_REQUESTED", "LAYOUT_PROCESSING_REQUESTED"],
        },
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    let published = 0;
    for (const event of events) {
      const queue =
        event.eventType === "LAYOUT_PROCESSING_REQUESTED"
          ? this.layoutQueue
          : this.fileQueue;
      await queue.add(event.eventType, event.payload, {
        jobId: event.dedupKey,
      });
      const updated = await this.prisma.outboxEvent.updateMany({
        where: { id: event.id, publishedAt: null },
        data: { publishedAt: new Date() },
      });
      published += updated.count;
    }
    return published;
  }

  async ready(): Promise<void> {
    await Promise.all([
      this.fileQueue.waitUntilReady(),
      this.layoutQueue.waitUntilReady(),
    ]);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.all([this.fileQueue.close(), this.layoutQueue.close()]);
  }
}
