import { Module } from "@nestjs/common";
import { AntivirusService } from "./antivirus.service";
import { CommandIsolatedProcessorService } from "./command-isolated-processor.service";
import { OutboxDispatcherService } from "./outbox-dispatcher.service";
import {
  environmentProvider,
  PrivateObjectStorageService,
} from "./private-object-storage.service";
import { ProcessingResultService } from "./processing-result.service";
import { ProcessingWorkerService } from "./processing-worker.service";
import { UploadCleanupService } from "./upload-cleanup.service";
import { UploadService } from "./upload.service";
import { UploadsController } from "./uploads.controller";

@Module({
  controllers: [UploadsController],
  providers: [
    environmentProvider,
    PrivateObjectStorageService,
    AntivirusService,
    CommandIsolatedProcessorService,
    UploadService,
    UploadCleanupService,
    OutboxDispatcherService,
    ProcessingResultService,
    ProcessingWorkerService,
  ],
  exports: [
    AntivirusService,
    CommandIsolatedProcessorService,
    OutboxDispatcherService,
    PrivateObjectStorageService,
    ProcessingResultService,
    UploadService,
  ],
})
export class UploadsModule {}
