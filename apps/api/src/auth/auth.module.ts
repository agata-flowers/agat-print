import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { loadEnvironment } from "../config/environment";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AccessGuard } from "./access.guard";
import { MockOtpProvider } from "./mock-otp.provider";
import { HttpOtpProvider } from "./http-otp.provider";
import { OTP_PROVIDER } from "../providers/provider-tokens";

@Global()
@Module({
  imports: [JwtModule.register({ secret: loadEnvironment().jwtSecret })],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessGuard,
    MockOtpProvider,
    HttpOtpProvider,
    {
      provide: OTP_PROVIDER,
      inject: [MockOtpProvider, HttpOtpProvider],
      useFactory: (mock: MockOtpProvider, http: HttpOtpProvider) =>
        loadEnvironment().otpProvider === "mock" ? mock : http,
    },
  ],
  exports: [AccessGuard, JwtModule],
})
export class AuthModule {}
