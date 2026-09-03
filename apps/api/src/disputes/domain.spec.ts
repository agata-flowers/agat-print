import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { assertDisputeWindow, refundAmount, retentionLock } from "./domain";

describe("stage 8 bounded dispute and refund rules", () => {
  it("executes the retention lock without deserializing a PostgreSQL void result", async () => {
    const execute = vi.fn().mockResolvedValue(1);
    await retentionLock({
      $executeRaw: execute,
    } as unknown as Prisma.TransactionClient);
    expect(execute).toHaveBeenCalledOnce();
  });
  it("uses an immutable terminal timestamp and closes the window at exactly 72 hours", () => {
    const terminal = new Date("2026-09-01T00:00:00Z");
    expect(
      assertDisputeWindow(
        terminal,
        new Date("2026-09-03T23:59:59.999Z"),
      ).toISOString(),
    ).toBe("2026-09-04T00:00:00.000Z");
    expect(() =>
      assertDisputeWindow(terminal, new Date("2026-09-04T00:00:00Z")),
    ).toThrow();
    expect(() => assertDisputeWindow(null)).toThrow();
  });
  it("does not permit reprint plus refund or an amount on NO_ACTION", () => {
    expect(refundAmount("REPRINT", undefined, 1000n, 0n)).toBeNull();
    expect(() => refundAmount("REPRINT", "1", 1000n, 0n)).toThrow();
    expect(() => refundAmount("NO_ACTION", "1", 1000n, 0n)).toThrow();
  });
  it("computes only the remaining full refund using integer minor units", () => {
    expect(refundAmount("FULL_REFUND", undefined, 1250n, 250n)).toBe(1000n);
    expect(() =>
      refundAmount("FULL_REFUND", undefined, 1250n, 1250n),
    ).toThrow();
    expect(() => refundAmount("FULL_REFUND", "10", 1250n, 0n)).toThrow();
  });
  it.each(["0", "-1", "1.2", "1e3", "NaN", "1250", "9999999999999999"])(
    "rejects invalid partial amount %s",
    (amount) => {
      expect(() => refundAmount("PARTIAL_REFUND", amount, 1250n, 0n)).toThrow();
    },
  );
  it("reserves pending refunds as well as confirmed refunds", () => {
    expect(refundAmount("PARTIAL_REFUND", "249", 1250n, 1000n)).toBe(249n);
    expect(() => refundAmount("PARTIAL_REFUND", "250", 1250n, 1000n)).toThrow();
  });
});
