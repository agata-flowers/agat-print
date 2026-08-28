import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AntivirusService } from "../uploads/antivirus.service";
import { OutboxDispatcherService } from "../uploads/outbox-dispatcher.service";
import { PrivateObjectStorageService } from "../uploads/private-object-storage.service";
@Controller("health")
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PrivateObjectStorageService)
    private readonly storage: PrivateObjectStorageService,
    @Inject(AntivirusService) private readonly antivirus: AntivirusService,
    @Inject(OutboxDispatcherService)
    private readonly outbox: OutboxDispatcherService,
  ) {}
  @Get("live") live() {
    return { status: "ok" };
  }
  @Get("ready") async ready() {
    try {
      await Promise.all([
        this.prisma.$queryRaw`SELECT 1`,
        this.storage.ready(),
        this.antivirus.ready(),
        this.outbox.ready(),
      ]);
      return { status: "ready" };
    } catch {
      throw new ServiceUnavailableException(
        "A required dependency is unavailable",
      );
    }
  }
}
