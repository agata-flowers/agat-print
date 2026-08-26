import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { loadEnvironment } from "../config/environment";

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
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
