import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Worker, type Job } from "bullmq";
import type { AppEnvironment } from "../config/environment";
import { PrismaService } from "../prisma/prisma.service";
import { CommandIsolatedProcessorService } from "./command-isolated-processor.service";
import {
  APP_ENVIRONMENT,
  PrivateObjectStorageService,
} from "./private-object-storage.service";
import { ProcessingResultService } from "./processing-result.service";

interface ProcessingPayload {
  jobId: string;
  operation: "NORMALIZE";
  dedupKey: string;
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
export class ProcessingWorkerService implements OnModuleDestroy {
  private worker?: Worker<ProcessingPayload>;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PrivateObjectStorageService)
    private readonly storage: PrivateObjectStorageService,
    @Inject(ProcessingResultService)
    private readonly results: ProcessingResultService,
    @Inject(CommandIsolatedProcessorService)
    private readonly processor: CommandIsolatedProcessorService,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {}

  start(): void {
    if (this.worker) return;
    this.worker = new Worker<ProcessingPayload>(
      "file-processing",
      (job) => this.handle(job),
      {
        connection: connectionOptions(this.env.redisUrl),
        concurrency: 2,
        lockDuration: 5 * 60_000,
      },
    );
  }

  private async handle(job: Job<ProcessingPayload>): Promise<void> {
    const { jobId, dedupKey, operation } = job.data;
    if (
      typeof jobId !== "string" ||
      typeof dedupKey !== "string" ||
      operation !== "NORMALIZE"
    )
      throw new Error("Invalid bounded processing payload");
    const claim = await this.results.claim(jobId, dedupKey);
    if (claim.duplicate) return;
    try {
      const record = await this.prisma.processingJob.findUniqueOrThrow({
        where: { id: jobId },
        include: { upload: true },
      });
      if (!record.upload.permanentObjectKey)
        throw new Error("Processing input is unavailable");
      const input = await this.storage.get(
        record.upload.permanentObjectKey,
        this.env.uploadMaxFileBytes,
      );
      const output = await this.processor.normalize(
        record.upload.fileKind,
        input,
      );
      await this.results.complete(jobId, dedupKey, claim.leaseOwner, output);
    } catch (error) {
      await this.results.fail(
        jobId,
        claim.leaseOwner,
        job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
      );
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
