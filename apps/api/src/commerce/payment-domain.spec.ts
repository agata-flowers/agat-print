import { describe, expect, it } from "vitest";
import {
  paymentSnapshotDigest,
  paymentTransition,
  protectProviderReference,
  revealProviderReference,
} from "./payment-domain";

describe("Stage 14 payment domain", () => {
  it("keeps terminal success monotonic and flags contradictory terminal events", () => {
    expect(paymentTransition("PROCESSING", "SUCCEEDED")).toEqual({
      attempt: "SUCCEEDED",
      payment: "SUCCEEDED",
    });
    expect(paymentTransition("SUCCEEDED", "FAILED")).toEqual({
      attempt: "SUCCEEDED",
      payment: "SUCCEEDED",
    });
    expect(paymentTransition("FAILED", "SUCCEEDED")).toEqual({
      attempt: "UNKNOWN",
      payment: "UNKNOWN",
    });
  });

  it("protects provider references and produces stable snapshot digests", () => {
    const key = Buffer.alloc(32, "p").toString("base64");
    const protectedValue = protectProviderReference("provider_reference", key);
    expect(protectedValue).not.toContain("provider_reference");
    expect(revealProviderReference(protectedValue, key)).toBe(
      "provider_reference",
    );
    const input = {
      orderId: "00000000-0000-4000-8000-000000000001",
      priceSnapshotId: "00000000-0000-4000-8000-000000000002",
      totalMinor: 12000n,
      currency: "UZS",
      fulfillmentSnapshotId: null,
      studioSnapshotId: null,
    };
    expect(paymentSnapshotDigest(input)).toBe(paymentSnapshotDigest(input));
  });
});
