import { Module } from "@nestjs/common";
import { UploadsModule } from "../uploads/uploads.module";
import {
  LayoutsController,
  ManualReviewsController,
} from "./layouts.controller";
import { LayoutProcessingWorkerService } from "./layout-processing-worker.service";
import { LayoutsService } from "./layouts.service";

@Module({
  imports: [UploadsModule],
  controllers: [LayoutsController, ManualReviewsController],
  providers: [LayoutsService, LayoutProcessingWorkerService],
  exports: [LayoutsService, LayoutProcessingWorkerService],
})
export class LayoutsModule {}
