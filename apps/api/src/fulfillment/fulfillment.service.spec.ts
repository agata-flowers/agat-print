import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { FulfillmentService } from "./fulfillment.service";

const serializationConflict = () =>
  new Prisma.PrismaClientKnownRequestError("internal transaction detail", {
    code: "P2034",
    clientVersion: "test",
  });

describe("FulfillmentService courier assignment retries", () => {
  it("retries the complete transaction without duplicating the provider operation", async () => {
    const orderId = "10000000-0000-4000-8000-000000000001";
    const fulfillmentId = "10000000-0000-4000-8000-000000000002";
    const cycleId = "10000000-0000-4000-8000-000000000003";
    const courierId = "10000000-0000-4000-8000-000000000004";
    const branchId = "10000000-0000-4000-8000-000000000005";
    const deliveryId = "10000000-0000-4000-8000-000000000006";
    const dedupKey = "stage7-reprint-courier-event";
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      inboxOperation: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      order: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: orderId,
          status: "AWAITING_PICKUP",
          version: 7,
          productionCycles: [{ id: cycleId }],
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      courierProfile: {
        findFirst: vi.fn().mockResolvedValue({ id: courierId }),
      },
      deliveryTask: {
        create: vi.fn().mockResolvedValue({ id: deliveryId }),
      },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      inboxOperation: { findUnique: vi.fn().mockResolvedValue(null) },
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: orderId,
          fulfillments: [
            { id: fulfillmentId, mode: "DELIVERY", productionCycleId: cycleId },
          ],
          assignments: [{ branchId, branch: { locationCode: "ZONE" } }],
        }),
      },
      courierProfile: {
        findFirst: vi.fn().mockResolvedValue({ id: courierId }),
      },
      $transaction: vi
        .fn()
        .mockRejectedValueOnce(serializationConflict())
        .mockImplementationOnce((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
    };
    const provider = {
      createDelivery: vi.fn().mockResolvedValue({ reference: "opaque-ref" }),
    };
    const service = new FulfillmentService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      provider,
      {} as never,
      {} as never,
    );

    await expect(service.assignDelivery(orderId, dedupKey)).resolves.toEqual({
      duplicate: false,
      deliveryId,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(provider.createDelivery).toHaveBeenCalledOnce();
    expect(tx.deliveryTask.create).toHaveBeenCalledOnce();
    expect(tx.inboxOperation.create).toHaveBeenCalledOnce();
    expect(tx.outboxEvent.create).toHaveBeenCalledOnce();
  });
});

describe("FulfillmentService assigned partner lifecycle", () => {
  it.each(["APPROVED", "ACTIVE", "SUSPENDED"])(
    "allows a %s studio to finish already assigned fulfillment",
    async (status) => {
      const findUnique = vi.fn().mockResolvedValue({ id: "partner", status });
      const service = new FulfillmentService(
        { partner: { findUnique } } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      const lifecycle = service as unknown as {
        requireApprovedPartner(ownerId: string): Promise<{ id: string }>;
      };

      await expect(
        lifecycle.requireApprovedPartner("owner"),
      ).resolves.toMatchObject({ id: "partner" });
      expect(findUnique).toHaveBeenCalledWith({ where: { ownerId: "owner" } });
    },
  );
});
