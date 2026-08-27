import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Role } from "@prisma/client";
import type { RequestWithUser } from "../common/request-with-user";

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = request.cookies?.agat_access as string | undefined;
    if (!token) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        roles: Role[];
        sid: string;
      }>(token);
      request.user = {
        id: payload.sub,
        roles: payload.roles,
        sessionId: payload.sid,
      };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
