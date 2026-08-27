import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AdminBootstrapService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async bootstrap(phone: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const used = await tx.bootstrapState.findUnique({
        where: { key: "production-admin" },
      });
      const adminCount = await tx.userRole.count({ where: { role: "ADMIN" } });
      if (used || adminCount > 0)
        throw new ConflictException(
          "Production administrator bootstrap has already been used",
        );
      const user = await tx.user.upsert({
        where: { phone },
        update: {},
        create: { phone, roles: { create: { role: "CUSTOMER" } } },
      });
      await tx.userRole.create({ data: { userId: user.id, role: "ADMIN" } });
      await tx.bootstrapState.create({
        data: { key: "production-admin", usedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          eventType: "admin.bootstrapped",
          targetType: "user",
          metadata: { result: "success" },
        },
      });
    });
  }
}
