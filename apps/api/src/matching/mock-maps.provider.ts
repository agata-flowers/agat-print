import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { MapsProvider, ProviderContext } from "@agat/providers";

@Injectable()
export class MockMapsProvider implements MapsProvider {
  geocode(query: string, context: ProviderContext) {
    void context;
    const bytes = createHash("sha256").update(query).digest();
    return Promise.resolve({
      latitude: 41 + bytes.readUInt16BE(0) / 655_350,
      longitude: 69 + bytes.readUInt16BE(2) / 655_350,
    });
  }

  async distanceScore(originCode: string, destinationCode: string) {
    const [origin, destination] = await Promise.all([
      this.geocode(originCode, {
        idempotencyKey: "maps-origin",
        correlationId: "matching",
      }),
      this.geocode(destinationCode, {
        idempotencyKey: "maps-destination",
        correlationId: "matching",
      }),
    ]);
    return Math.round(
      ((origin.latitude - destination.latitude) ** 2 +
        (origin.longitude - destination.longitude) ** 2) *
        1_000_000,
    );
  }
}
