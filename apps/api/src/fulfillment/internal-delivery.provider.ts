import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { DeliveryProvider, ProviderContext } from "@agat/providers";

/**
 * Provider-neutral pilot dispatcher. It creates a stable internal delivery
 * reference; courier assignment remains in the existing fulfillment domain.
 */
@Injectable()
export class InternalDeliveryProvider implements DeliveryProvider {
  createDelivery(orderId: string, context: ProviderContext) {
    return Promise.resolve({
      reference: createHash("sha256")
        .update(`internal-delivery:${orderId}:${context.idempotencyKey}`)
        .digest("hex"),
    });
  }
}
