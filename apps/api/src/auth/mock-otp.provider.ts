import { Injectable } from "@nestjs/common";
import type { OtpProvider, ProviderContext } from "@agat/providers";
import { loadEnvironment } from "../config/environment";

@Injectable()
export class MockOtpProvider implements OtpProvider {
  send(_phone: string, code: string, _context: ProviderContext): Promise<void> {
    void _context;
    const env = loadEnvironment();
    if (env.nodeEnv === "production")
      throw new Error("Mock OTP is forbidden in production");
    if (code !== env.mockOtpCode) throw new Error("Unexpected mock OTP code");
    return Promise.resolve();
  }
}
