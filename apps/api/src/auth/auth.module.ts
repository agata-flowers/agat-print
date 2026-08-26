import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { loadEnvironment } from "../config/environment";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AccessGuard } from "./access.guard";
import { MockOtpProvider } from "./mock-otp.provider";

@Global()
@Module({
  imports: [JwtModule.register({ secret: loadEnvironment().jwtSecret })],
  controllers: [AuthController],
  providers: [AuthService, AccessGuard, MockOtpProvider],
  exports: [AccessGuard, JwtModule],
})
export class AuthModule {}
