import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  isRetryableTransactionConflict,
  withSerializableRetry,
} from "./serializable-retry";

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError("internal database detail", {
    code,
    clientVersion: "test",
    meta,
  });

describe("serializable transaction retry", () => {
  it("retries a serialization conflict with bounded exponential delays", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(prismaError("P2034"))
      .mockRejectedValueOnce(prismaError("P2034"))
      .mockResolvedValue("committed");
    const sleep = vi
      .fn<(delayMs: number) => Promise<void>>()
      .mockResolvedValue();

    await expect(withSerializableRetry(operation, { sleep })).resolves.toBe(
      "committed",
    );
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[20], [40]]);
  });

  it.each(["40001", "40P01"])(
    "retries PostgreSQL conflict code %s returned through a raw query",
    async (databaseCode) => {
      const sleep = vi
        .fn<(delayMs: number) => Promise<void>>()
        .mockResolvedValue();
      const operation = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(prismaError("P2010", { code: databaseCode }))
        .mockResolvedValue("committed");
      await expect(withSerializableRetry(operation, { sleep })).resolves.toBe(
        "committed",
      );
      expect(operation).toHaveBeenCalledTimes(2);
    },
  );

  it("fails closed with a bounded conflict after exhausting all attempts", async () => {
    const operation = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(prismaError("P2034"));
    const sleep = vi
      .fn<(delayMs: number) => Promise<void>>()
      .mockResolvedValue();

    const error = await withSerializableRetry(operation, { sleep }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: "CONCURRENT_CHANGE",
    });
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(
      JSON.stringify((error as ConflictException).getResponse()),
    ).not.toMatch(/database|deadlock|serialization|P2034|internal/i);
  });

  it("does not retry or translate a non-transaction error", async () => {
    const original = prismaError("P2025");
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(original);
    await expect(withSerializableRetry(operation)).rejects.toBe(original);
    expect(operation).toHaveBeenCalledOnce();
    expect(isRetryableTransactionConflict(original)).toBe(false);
  });
});
