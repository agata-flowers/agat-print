import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { DeliveryProvider, ProviderContext } from "@agat/providers";

@Injectable()
export class MockDeliveryProvider implements DeliveryProvider {
  createDelivery(orderId: string, context: ProviderContext) {
    return Promise.resolve({
      reference: createHash("sha256")
        .update(`${orderId}:${context.idempotencyKey}`)
        .digest("hex"),
    });
  }
}
