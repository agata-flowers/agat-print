import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { PaymentAttemptStatus, PaymentStatus } from "@prisma/client";

export type PaymentObservation =
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "UNKNOWN"
  | "CANCELLED";

const terminal = new Set<PaymentAttemptStatus>([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);

export function paymentTransition(
  current: PaymentAttemptStatus,
  observation: PaymentObservation,
): { attempt: PaymentAttemptStatus; payment: PaymentStatus } {
  if (current === "SUCCEEDED")
    return { attempt: current, payment: "SUCCEEDED" };
  if (terminal.has(current) && current !== observation)
    return { attempt: "UNKNOWN", payment: "UNKNOWN" };
  const allowed: Record<PaymentAttemptStatus, PaymentObservation[]> = {
    CREATED: ["PROCESSING", "CANCELLED"],
    PROCESSING: ["PROCESSING", "SUCCEEDED", "FAILED", "UNKNOWN"],
    UNKNOWN: ["PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED", "UNKNOWN"],
    SUCCEEDED: ["SUCCEEDED"],
    FAILED: ["FAILED"],
    CANCELLED: ["CANCELLED"],
  };
  if (!allowed[current].includes(observation))
    return { attempt: "UNKNOWN", payment: "UNKNOWN" };
  return { attempt: observation, payment: observation };
}

export function paymentSnapshotDigest(input: {
  orderId: string;
  priceSnapshotId: string;
  totalMinor: bigint;
  currency: string;
  fulfillmentSnapshotId?: string | null;
  studioSnapshotId?: string | null;
}): string {
  return createHash("sha256")
    .update(
      [
        input.orderId,
        input.priceSnapshotId,
        input.totalMinor.toString(),
        input.currency,
        input.fulfillmentSnapshotId ?? "legacy",
        input.studioSnapshotId ?? "auto",
      ].join(":"),
    )
    .digest("hex");
}

const referenceKey = (encoded: string): Buffer => {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("PAYMENT_REFERENCE_KEY_INVALID");
  return key;
};

export function protectProviderReference(
  reference: string,
  key: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", referenceKey(key), iv);
  const ciphertext = Buffer.concat([
    cipher.update(reference, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function revealProviderReference(value: string, key: string): string {
  const [ivValue, tagValue, cipherValue] = value.split(".");
  if (!ivValue || !tagValue || !cipherValue)
    throw new Error("PAYMENT_REFERENCE_INVALID");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    referenceKey(key),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export const providerReferenceDigest = (reference: string): string =>
  createHash("sha256").update(reference).digest("hex");
