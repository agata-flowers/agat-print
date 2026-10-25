import { describe, expect, it, vi } from "vitest";
import type { IdempotencyService } from "../commerce/idempotency.service";
import type { PrismaService } from "../prisma/prisma.service";
import { DisputesService } from "./disputes.service";

describe("partner aftercare lifecycle compatibility", () => {
  it("allows active and suspended studios to access existing dispute work", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "partner" });
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new DisputesService(
      {
        partner: { findFirst },
        disputeCase: { findMany },
      } as unknown as PrismaService,
      {} as IdempotencyService,
    );

    await expect(service.partnerList("owner")).resolves.toEqual([]);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        ownerId: "owner",
        status: { in: ["APPROVED", "ACTIVE", "SUSPENDED"] },
      },
    });
    expect(findMany).toHaveBeenCalledOnce();
  });
});
