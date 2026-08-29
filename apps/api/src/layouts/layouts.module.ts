import { Module } from "@nestjs/common";
import { UploadsModule } from "../uploads/uploads.module";
import {
  LayoutsController,
  ManualReviewsController,
} from "./layouts.controller";
import { LayoutsService } from "./layouts.service";

@Module({
  imports: [UploadsModule],
  controllers: [LayoutsController, ManualReviewsController],
  providers: [LayoutsService],
  exports: [LayoutsService],
})
export class LayoutsModule {}
