import { randomUUID } from "node:crypto";
import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { loadEnvironment } from "../config/environment";
import {
  digest,
  normalizePhone,
  randomToken,
  safeDigestEqual,
} from "./auth.crypto";
import { MockOtpProvider } from "./mock-otp.provider";

interface SessionResult {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  user: { id: string; roles: Role[]; locale: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly otp: MockOtpProvider,
    private readonly audit: AuditService,
  ) {}

  async requestOtp(
    rawPhone: string,
  ): Promise<{ accepted: true; developmentCode?: string }> {
    const phone = normalizePhone(rawPhone);
    const env = loadEnvironment();
    const since = new Date(Date.now() - 3_600_000);
    const recent = await this.prisma.otpChallenge.count({
      where: { phone, createdAt: { gte: since } },
    });
    if (recent >= env.otpRateLimitPerHour)
      throw new HttpException(
        "OTP rate limit exceeded",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const code = env.mockOtpCode;
    const challenge = await this.prisma.otpChallenge.create({
      data: {
        phone,
        codeDigest: digest(code),
        maxAttempts: env.otpMaxAttempts,
        expiresAt: new Date(Date.now() + env.otpTtlSeconds * 1000),
      },
    });
    await this.otp.send(phone, code, {
      idempotencyKey: challenge.id,
      correlationId: challenge.id,
    });
    return env.nodeEnv === "development"
      ? { accepted: true, developmentCode: code }
      : { accepted: true };
  }

  async verifyOtp(
    rawPhone: string,
    code: string,
    locale = "ru",
  ): Promise<SessionResult> {
    const phone = normalizePhone(rawPhone);
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phone, usedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (
      !challenge ||
      challenge.expiresAt <= new Date() ||
      challenge.attempts >= challenge.maxAttempts
    )
      throw new UnauthorizedException("OTP is invalid or expired");
    if (!safeDigestEqual(code, challenge.codeDigest)) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException("OTP is invalid or expired");
    }
    const user = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.otpChallenge.updateMany({
        where: { id: challenge.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1)
        throw new UnauthorizedException("OTP was already used");
      return tx.user.upsert({
        where: { phone },
        update: { locale },
        create: { phone, locale, roles: { create: { role: "CUSTOMER" } } },
        include: { roles: true },
      });
    });
    const session = await this.createSession(
      user.id,
      user.roles.map((item) => item.role),
      user.locale,
    );
    await this.audit.record("auth.login", user.id, "session", {
      result: "success",
    });
    return session;
  }

  async refresh(serialized: string): Promise<SessionResult> {
    const [sessionId, secret] = serialized.split(".");
    if (!sessionId || !secret)
      throw new UnauthorizedException("Invalid refresh token");
    const current = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: { include: { roles: true } } },
    });
    if (
      !current ||
      !safeDigestEqual(secret, current.refreshDigest) ||
      current.expiresAt <= new Date()
    )
      throw new UnauthorizedException("Invalid refresh token");
    if (current.revokedAt) {
      await this.prisma.session.updateMany({
        where: { familyId: current.familyId, revokedAt: null },
        data: { revokedAt: new Date(), reuseDetectedAt: new Date() },
      });
      throw new UnauthorizedException("Refresh token reuse detected");
    }
    const roles = current.user.roles.map((item) => item.role);
    const result = await this.createSession(
      current.userId,
      roles,
      current.user.locale,
      current.familyId,
    );
    const nextId = result.refreshToken.split(".")[0];
    await this.prisma.session.updateMany({
      where: { id: current.id, revokedAt: null },
      data: { revokedAt: new Date(), replacedById: nextId },
    });
    return result;
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createSession(
    userId: string,
    roles: Role[],
    locale: string,
    familyId: string = randomUUID(),
  ): Promise<SessionResult> {
    const env = loadEnvironment();
    const id = randomUUID();
    const secret = randomToken();
    await this.prisma.session.create({
      data: {
        id,
        userId,
        familyId,
        refreshDigest: digest(secret),
        expiresAt: new Date(Date.now() + env.refreshTtlSeconds * 1000),
      },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: userId, roles, sid: id },
      { expiresIn: env.accessTtlSeconds },
    );
    return {
      accessToken,
      refreshToken: `${id}.${secret}`,
      csrfToken: randomToken(),
      user: { id: userId, roles, locale },
    };
  }
}
