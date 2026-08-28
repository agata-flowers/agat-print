import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { UploadService } from "./upload.service";

@Injectable()
export class UploadCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(@Inject(UploadService) private readonly uploads: UploadService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.uploads.cleanupExpired().catch(() => undefined);
    }, 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
