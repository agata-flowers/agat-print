import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Worker, type Job } from "bullmq";
import type { AppEnvironment } from "../config/environment";
import { PrismaService } from "../prisma/prisma.service";
import { APP_ENVIRONMENT } from "../uploads/private-object-storage.service";
import { LayoutsService } from "./layouts.service";

interface LayoutProcessingPayload {
  layoutId: string;
  operation: "PREFLIGHT";
  dedupKey: string;
  settingsHash: string;
}

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
export class LayoutProcessingWorkerService implements OnModuleDestroy {
  private worker?: Worker<LayoutProcessingPayload>;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LayoutsService) private readonly layouts: LayoutsService,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {}

  start(): void {
    if (this.worker) return;
    this.worker = new Worker<LayoutProcessingPayload>(
      "layout-processing",
      (job) => this.handle(job),
      {
        connection: connectionOptions(this.env.redisUrl),
        concurrency: 2,
        lockDuration: 5 * 60_000,
      },
    );
  }

  private async handle(job: Job<LayoutProcessingPayload>): Promise<void> {
    const { layoutId, operation, dedupKey, settingsHash } = job.data;
    if (
      typeof layoutId !== "string" ||
      typeof dedupKey !== "string" ||
      dedupKey.length !== 64 ||
      typeof settingsHash !== "string" ||
      settingsHash.length !== 64 ||
      operation !== "PREFLIGHT"
    )
      throw new Error("Invalid bounded layout processing payload");
    const completed = await this.prisma.inboxOperation.findUnique({
      where: { dedupKey },
    });
    if (completed) return;

    await this.layouts.processPending(layoutId, settingsHash);
    try {
      await this.prisma.inboxOperation.create({
        data: {
          dedupKey,
          operation: "LAYOUT_PREFLIGHT",
          resultId: layoutId,
        },
      });
    } catch (error) {
      if (
        !(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
      )
        throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
