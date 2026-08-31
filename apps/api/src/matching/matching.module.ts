import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CommerceModule } from "../commerce/commerce.module";
import { UploadsModule } from "../uploads/uploads.module";
import {
  AdminMatchingController,
  PartnerMatchingController,
} from "./matching.controller";
import { MatchingQueueService } from "./matching-queue.service";
import { MatchingService } from "./matching.service";
import { MockMapsProvider } from "./mock-maps.provider";
import { MockNotificationProvider } from "./mock-notification.provider";

@Module({
  imports: [AuditModule, CommerceModule, UploadsModule],
  controllers: [PartnerMatchingController, AdminMatchingController],
  providers: [
    MatchingService,
    MatchingQueueService,
    MockMapsProvider,
    MockNotificationProvider,
  ],
  exports: [MatchingService, MatchingQueueService],
})
export class MatchingModule {}
