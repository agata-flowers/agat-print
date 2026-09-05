import { Module } from "@nestjs/common";
import { UploadsModule } from "../uploads/uploads.module";
import {
  CommerceAdminController,
  CommerceController,
  MockPaymentCallbackController,
  PaymentWebhookController,
} from "./commerce.controller";
import { CommerceService } from "./commerce.service";
import { IdempotencyService } from "./idempotency.service";
import { MockPaymentProvider } from "./mock-payment.provider";
import { HttpPaymentProvider } from "./http-payment.provider";
import { PAYMENT_PROVIDER } from "../providers/provider-tokens";
import { loadEnvironment } from "../config/environment";

@Module({
  imports: [UploadsModule],
  controllers: [
    CommerceController,
    CommerceAdminController,
    MockPaymentCallbackController,
    PaymentWebhookController,
  ],
  providers: [
    CommerceService,
    IdempotencyService,
    MockPaymentProvider,
    HttpPaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [MockPaymentProvider, HttpPaymentProvider],
      useFactory: (mock: MockPaymentProvider, http: HttpPaymentProvider) =>
        loadEnvironment().paymentProvider === "mock" ? mock : http,
    },
  ],
  exports: [CommerceService, IdempotencyService, PAYMENT_PROVIDER],
})
export class CommerceModule {}
