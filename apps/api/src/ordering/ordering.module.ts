import { Module } from "@nestjs/common";
import { CommerceModule } from "../commerce/commerce.module";
import {
  CatalogController,
  CustomerOrderingController,
  AdminCatalogController,
  CustomerBasketController,
} from "./ordering.controller";
import { OrderingService } from "./ordering.service";
import { NotificationWorkerService } from "./notification-worker.service";
import { UploadsModule } from "../uploads/uploads.module";
import { LayoutsModule } from "../layouts/layouts.module";
import { FulfillmentModule } from "../fulfillment/fulfillment.module";
import { BasketService } from "./basket.service";

@Module({
  imports: [CommerceModule, UploadsModule, LayoutsModule, FulfillmentModule],
  controllers: [
    CatalogController,
    CustomerOrderingController,
    AdminCatalogController,
    CustomerBasketController,
  ],
  providers: [OrderingService, BasketService, NotificationWorkerService],
  exports: [OrderingService, NotificationWorkerService],
})
export class OrderingModule {}
