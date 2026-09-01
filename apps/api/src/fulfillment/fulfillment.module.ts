import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CommerceModule } from "../commerce/commerce.module";
import { UploadsModule } from "../uploads/uploads.module";
import {
  AdminFulfillmentController,
  CourierApplicationController,
  CourierDeliveryController,
  CustomerFulfillmentController,
  PartnerFulfillmentController,
  PrinterAgentController,
} from "./fulfillment.controller";
import { FulfillmentCrypto } from "./fulfillment.crypto";
import { FulfillmentQueueService } from "./fulfillment-queue.service";
import { FulfillmentService } from "./fulfillment.service";
import { MockDeliveryProvider } from "./mock-delivery.provider";
import { PrinterAgentGuard } from "./printer-agent.guard";

@Module({
  imports: [AuditModule, CommerceModule, UploadsModule],
  controllers: [
    CustomerFulfillmentController,
    CourierApplicationController,
    PartnerFulfillmentController,
    CourierDeliveryController,
    AdminFulfillmentController,
    PrinterAgentController,
  ],
  providers: [
    FulfillmentService,
    FulfillmentCrypto,
    FulfillmentQueueService,
    MockDeliveryProvider,
    PrinterAgentGuard,
  ],
  exports: [FulfillmentService, FulfillmentQueueService],
})
export class FulfillmentModule {}
