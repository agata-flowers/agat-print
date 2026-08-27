import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import type { CreatePartnerDto } from "./dto";

@Injectable()
export class PartnersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}
  async create(ownerId: string, input: CreatePartnerDto) {
    const exists = await this.prisma.partner.findUnique({ where: { ownerId } });
    if (exists)
      throw new ConflictException("Partner application already exists");
    const partner = await this.prisma.partner.create({
      data: {
        ownerId,
        displayName: input.displayName,
        branches: {
          create: { name: input.branchName, district: input.district },
        },
      },
      include: { branches: true },
    });
    await this.audit.record("partner.applied", ownerId, "partner", {
      status: "PENDING",
    });
    return partner;
  }
  async own(ownerId: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { ownerId },
      include: { branches: true },
    });
    if (!partner) throw new NotFoundException();
    return partner;
  }
  async approve(partnerId: string, actorId: string) {
    const partner = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.partner.findUnique({
        where: { id: partnerId },
      });
      if (!existing) throw new NotFoundException();
      const updated = await tx.partner.update({
        where: { id: partnerId },
        data: { status: "APPROVED", approvedAt: new Date() },
      });
      await tx.userRole.upsert({
        where: { userId_role: { userId: existing.ownerId, role: "PARTNER" } },
        create: { userId: existing.ownerId, role: "PARTNER" },
        update: {},
      });
      return updated;
    });
    await this.audit.record("partner.approved", actorId, "partner", {
      status: "APPROVED",
    });
    return partner;
  }
}
