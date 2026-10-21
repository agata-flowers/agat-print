import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { LayoutProcessingWorkerService } from "./layout-processing-worker.service";

const digest = "a".repeat(64);
const payload = {
  layoutId: "00000000-0000-4000-8000-000000000161",
  operation: "PREFLIGHT" as const,
  dedupKey: digest,
  settingsHash: "b".repeat(64),
};

const createService = (completed: object | null = null) => {
  const prisma = {
    inboxOperation: {
      findUnique: vi.fn().mockResolvedValue(completed),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const layouts = { processPending: vi.fn().mockResolvedValue({}) };
  const service = new LayoutProcessingWorkerService(
    prisma as never,
    layouts as never,
    { redisUrl: "redis://localhost:6379" } as never,
  );
  return { service, prisma, layouts };
};

describe("layout processing worker", () => {
  it("processes a bounded job once and records inbox completion", async () => {
    const { service, prisma, layouts } = createService();

    await service["handle"]({ data: payload } as never);

    expect(layouts.processPending).toHaveBeenCalledWith(
      payload.layoutId,
      payload.settingsHash,
    );
    expect(prisma.inboxOperation.create).toHaveBeenCalledWith({
      data: {
        dedupKey: payload.dedupKey,
        operation: "LAYOUT_PREFLIGHT",
        resultId: payload.layoutId,
      },
    });
  });

  it("does not repeat processing after inbox completion", async () => {
    const { service, prisma, layouts } = createService({
      dedupKey: payload.dedupKey,
    });

    await service["handle"]({ data: payload } as never);

    expect(layouts.processPending).not.toHaveBeenCalled();
    expect(prisma.inboxOperation.create).not.toHaveBeenCalled();
  });

  it("treats a concurrent inbox unique conflict as an idempotent replay", async () => {
    const { service, prisma, layouts } = createService();
    prisma.inboxOperation.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    await expect(
      service["handle"]({ data: payload } as never),
    ).resolves.toBeUndefined();
    expect(layouts.processPending).toHaveBeenCalledOnce();
  });

  it("fails closed for invalid jobs and leaves processing failures retryable", async () => {
    const invalid = createService();
    await expect(
      invalid.service["handle"]({
        data: { ...payload, settingsHash: "not-a-digest" },
      } as never),
    ).rejects.toThrow("Invalid bounded layout processing payload");
    expect(invalid.layouts.processPending).not.toHaveBeenCalled();

    const failed = createService();
    failed.layouts.processPending.mockRejectedValue(new Error("failed"));
    await expect(
      failed.service["handle"]({ data: payload } as never),
    ).rejects.toThrow("failed");
    expect(failed.prisma.inboxOperation.create).not.toHaveBeenCalled();
  });
});
