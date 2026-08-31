import { Module } from "@nestjs/common";
import { UploadsModule } from "../uploads/uploads.module";
import {
  CommerceAdminController,
  CommerceController,
  MockPaymentCallbackController,
} from "./commerce.controller";
import { CommerceService } from "./commerce.service";
import { IdempotencyService } from "./idempotency.service";
import { MockPaymentProvider } from "./mock-payment.provider";

@Module({
  imports: [UploadsModule],
  controllers: [
    CommerceController,
    CommerceAdminController,
    MockPaymentCallbackController,
  ],
  providers: [CommerceService, IdempotencyService, MockPaymentProvider],
  exports: [CommerceService, IdempotencyService],
})
export class CommerceModule {}
