import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const allowedMetadataKeys = new Set(["status", "role", "operation", "result"]);

@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async record(
    eventType: string,
    actorId?: string,
    targetType?: string,
    metadata: Record<string, string> = {},
  ): Promise<void> {
    const safe = Object.fromEntries(
      Object.entries(metadata)
        .filter(([key]) => allowedMetadataKeys.has(key))
        .map(([key, value]) => [key, value.slice(0, 80)]),
    );
    await this.prisma.auditEvent.create({
      data: { eventType, actorId, targetType, metadata: safe },
    });
  }
}
