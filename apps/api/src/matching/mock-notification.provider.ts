import { Injectable } from "@nestjs/common";
import type { NotificationProvider, ProviderContext } from "@agat/providers";

@Injectable()
export class MockNotificationProvider implements NotificationProvider {
  notify(
    userId: string,
    template: string,
    context: ProviderContext,
  ): Promise<void> {
    void userId;
    void template;
    void context;
    // Deliberately side-effect free. No identifier or message content is logged.
    return Promise.resolve();
  }
}
