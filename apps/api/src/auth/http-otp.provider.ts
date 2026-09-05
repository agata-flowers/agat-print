import { Injectable } from "@nestjs/common";
import type { OtpProvider, ProviderContext } from "@agat/providers";
import { loadEnvironment } from "../config/environment";
import { HttpProviderClient } from "../providers/http-provider.client";

@Injectable()
export class HttpOtpProvider implements OtpProvider {
  async send(
    phone: string,
    code: string,
    context: ProviderContext,
  ): Promise<void> {
    const env = loadEnvironment();
    const client = new HttpProviderClient(
      env.otpProviderEndpoint,
      env.otpProviderApiKey,
      env.providerTimeoutSeconds,
    );
    await client.post("otp/send", { phone, code }, context);
  }
}
