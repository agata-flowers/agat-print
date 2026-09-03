import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CommerceModule } from "../commerce/commerce.module";
import { UploadsModule } from "../uploads/uploads.module";
import {
  AdminDisputesController,
  CustomerDisputesController,
  PartnerDisputesController,
} from "./disputes.controller";
import { DisputesService } from "./disputes.service";
import { RetentionWorkerService } from "./retention-worker.service";
import { AftercareQueueService } from "./aftercare-queue.service";
import { MockNotificationProvider } from "../matching/mock-notification.provider";

@Module({
  imports: [AuditModule, CommerceModule, UploadsModule],
  controllers: [
    CustomerDisputesController,
    PartnerDisputesController,
    AdminDisputesController,
  ],
  providers: [
    DisputesService,
    RetentionWorkerService,
    AftercareQueueService,
    MockNotificationProvider,
  ],
  exports: [DisputesService, RetentionWorkerService, AftercareQueueService],
})
export class DisputesModule {}
