import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Inject,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { loadEnvironment } from "../config/environment";
import { PUBLIC_WEBHOOK } from "./public-webhook.decorator";

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_WEBHOOK, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    const env = loadEnvironment();
    if (request.headers.origin !== env.webOrigin)
      throw new ForbiddenException("Origin is not allowed");
    const cookie = request.cookies?.agat_csrf as string | undefined;
    const header = request.headers["x-csrf-token"];
    if (!cookie || typeof header !== "string" || header !== cookie)
      throw new ForbiddenException("Invalid CSRF token");
    return true;
  }
}
