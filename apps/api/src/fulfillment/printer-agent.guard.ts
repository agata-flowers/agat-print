import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { FulfillmentCrypto } from "./fulfillment.crypto";

export interface PrinterAgentRequest extends Request {
  printerAgent?: { id: string; branchId: string };
}

@Injectable()
export class PrinterAgentGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FulfillmentCrypto) private readonly crypto: FulfillmentCrypto,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PrinterAgentRequest>();
    const agentId = request.headers["x-printer-agent-id"];
    const authorization = request.headers.authorization;
    if (
      typeof agentId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(agentId) ||
      typeof authorization !== "string" ||
      !authorization.startsWith("Bearer ")
    )
      throw new UnauthorizedException();
    const token = authorization.slice(7);
    const agent = await this.prisma.printerAgent.findFirst({
      where: { id: agentId, status: "ACTIVE" },
      select: { id: true, branchId: true, tokenDigest: true },
    });
    if (!agent || !this.crypto.verifyAgentToken(token, agent.tokenDigest))
      throw new UnauthorizedException();
    request.printerAgent = { id: agent.id, branchId: agent.branchId };
    await this.prisma.printerAgent.update({
      where: { id: agent.id },
      data: { lastSeenAt: new Date() },
    });
    return true;
  }
}
