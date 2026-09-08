import { Module } from "@nestjs/common";
import { CommerceModule } from "../commerce/commerce.module";
import {
  CatalogController,
  CustomerOrderingController,
  AdminCatalogController,
} from "./ordering.controller";
import { OrderingService } from "./ordering.service";
import { NotificationWorkerService } from "./notification-worker.service";
import { UploadsModule } from "../uploads/uploads.module";
import { LayoutsModule } from "../layouts/layouts.module";

@Module({
  imports: [CommerceModule, UploadsModule, LayoutsModule],
  controllers: [
    CatalogController,
    CustomerOrderingController,
    AdminCatalogController,
  ],
  providers: [OrderingService, NotificationWorkerService],
  exports: [OrderingService, NotificationWorkerService],
})
export class OrderingModule {}
