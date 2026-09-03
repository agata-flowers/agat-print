import { createHash } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const activeDisputes = ["OPEN", "PARTNER_RESPONDED"] as const;
export const terminalStatuses = [
  "COMPLETED",
  "DELIVERY_FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;
export const holdExpiry = new Date("9999-01-01T00:00:00.000Z");

// Serializes deletion intent against new holds/reprints. Order locks follow this
// lock everywhere in aftercare; storage calls never occur inside the transaction.
export async function retentionLock(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(815008)`;
}

export function event(
  aggregateType: string,
  aggregateId: string,
  aggregateVersion: number,
  eventType: string,
): Prisma.OutboxEventCreateInput {
  return {
    aggregateType,
    aggregateId,
    aggregateVersion,
    eventType,
    dedupKey: digest(
      `${aggregateType}:${aggregateId}:${aggregateVersion}:${eventType}`,
    ),
    payload: { aggregateId, aggregateVersion },
  };
}

export async function orderObjectKeys(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      layout: {
        include: {
          upload: { include: { processingResults: true } },
          previews: true,
          printReadyVersions: true,
        },
      },
    },
  });
  return [
    ...new Set(
      [
        order.layout.upload.permanentObjectKey,
        ...order.layout.upload.processingResults.map((x) => x.objectKey),
        ...order.layout.previews.map((x) => x.objectKey),
        ...order.layout.printReadyVersions.map((x) => x.objectKey),
      ].filter((key): key is string => key !== null),
    ),
  ];
}

export async function protectObjects(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const keys = await orderObjectKeys(tx, orderId);
  // A hold never resurrects a deletion already committed by the deletion worker.
  await tx.permanentObjectReference.updateMany({
    where: { objectKey: { in: keys }, deletedAt: null },
    data: { expiresAt: holdExpiry },
  });
  await tx.retentionSchedule.updateMany({
    where: { orderId, status: { in: ["ACTIVE", "HELD"] } },
    data: { status: "SUPERSEDED" },
  });
}

export function refundAmount(
  resolution: string,
  input: string | undefined,
  paid: bigint,
  reserved: bigint,
) {
  if (resolution === "NO_ACTION" || resolution === "REPRINT") {
    if (input !== undefined)
      throw new ConflictException({ code: "UNEXPECTED_REFUND_AMOUNT" });
    return null;
  }
  const remaining = paid - reserved;
  if (resolution === "FULL_REFUND") {
    if (input !== undefined || remaining <= 0n)
      throw new ConflictException({ code: "INVALID_FULL_REFUND" });
    return remaining;
  }
  if (!input || !/^\d{1,15}$/.test(input))
    throw new ConflictException({ code: "INVALID_PARTIAL_REFUND" });
  const amount = BigInt(input);
  if (amount <= 0n || amount >= remaining)
    throw new ConflictException({ code: "INVALID_PARTIAL_REFUND" });
  return amount;
}

export function assertDisputeWindow(eligibleAt: Date | null, now = new Date()) {
  if (
    !eligibleAt ||
    now.getTime() >= eligibleAt.getTime() + 72 * 60 * 60 * 1000
  )
    throw new ConflictException({ code: "DISPUTE_WINDOW_EXPIRED" });
  return new Date(eligibleAt.getTime() + 72 * 60 * 60 * 1000);
}
