import { Controller, Get, UseGuards } from "@nestjs/common";
import { AccessGuard } from "../auth/access.guard";
import { CurrentUser } from "../common/current-user.decorator";
import type { AuthenticatedUser } from "../common/request-user";
import { PrismaService } from "../prisma/prisma.service";

@Controller("profile")
@UseGuards(AccessGuard)
export class ProfileController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() async get(@CurrentUser() user: AuthenticatedUser) {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        locale: true,
        displayName: true,
        roles: { select: { role: true } },
      },
    });
    return { ...record, roles: record.roles.map((item) => item.role) };
  }
}
