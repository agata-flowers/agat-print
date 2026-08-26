import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response, CookieOptions } from "express";
import { randomToken } from "./auth.crypto";
import { AuthService } from "./auth.service";
import { RequestOtpDto, VerifyOtpDto } from "./dto";
import { loadEnvironment } from "../config/environment";
import { AccessGuard } from "./access.guard";
import { UseGuards } from "@nestjs/common";
import { CurrentUser } from "../common/current-user.decorator";
import type { AuthenticatedUser } from "../common/request-user";

const cookieBase = (): CookieOptions => ({
  httpOnly: true,
  secure: loadEnvironment().nodeEnv === "production",
  sameSite: "lax",
});

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get("csrf") csrf(@Res({ passthrough: true }) response: Response) {
    const token = randomToken();
    response.cookie("agat_csrf", token, {
      secure: loadEnvironment().nodeEnv === "production",
      sameSite: "lax",
      path: "/",
    });
    return { csrfToken: token };
  }

  @Post("otp/request") @HttpCode(202) request(@Body() input: RequestOtpDto) {
    return this.auth.requestOtp(input.phone);
  }

  @Post("otp/verify") async verify(
    @Body() input: VerifyOtpDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.verifyOtp(
      input.phone,
      input.code,
      input.locale,
    );
    this.setSessionCookies(response, result);
    return { user: result.user, csrfToken: result.csrfToken };
  }

  @Post("refresh") async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = request.cookies?.agat_refresh as string | undefined;
    if (!token) throw new UnauthorizedException();
    const result = await this.auth.refresh(token);
    this.setSessionCookies(response, result);
    return { user: result.user, csrfToken: result.csrfToken };
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(AccessGuard)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(user.sessionId);
    response.clearCookie("agat_access", { ...cookieBase(), path: "/api" });
    response.clearCookie("agat_refresh", {
      ...cookieBase(),
      path: "/api/v1/auth",
    });
    response.clearCookie("agat_csrf", { path: "/" });
  }

  private setSessionCookies(
    response: Response,
    result: { accessToken: string; refreshToken: string; csrfToken: string },
  ): void {
    const env = loadEnvironment();
    response.cookie("agat_access", result.accessToken, {
      ...cookieBase(),
      path: "/api",
      maxAge: env.accessTtlSeconds * 1000,
    });
    response.cookie("agat_refresh", result.refreshToken, {
      ...cookieBase(),
      path: "/api/v1/auth",
      maxAge: env.refreshTtlSeconds * 1000,
    });
    response.cookie("agat_csrf", result.csrfToken, {
      secure: env.nodeEnv === "production",
      sameSite: "lax",
      path: "/",
    });
  }
}
