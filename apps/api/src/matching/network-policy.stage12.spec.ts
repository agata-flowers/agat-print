import { describe, expect, it } from "vitest";
import { comparePreferredCandidateScore } from "./network-policy";

describe("Stage 12 preferred studio ranking", () => {
  const candidate = (branchId: string, preferred: boolean, priority = 10) => ({
    branchId,
    preferred,
    priority,
    distanceMeters: 1000,
    workloadBasisPoints: 1000,
  });

  it("ranks a fully eligible preferred studio before normal score", () => {
    const rows = [
      candidate("automatic", false, 1),
      candidate("preferred", true, 999),
    ].sort(comparePreferredCandidateScore);
    expect(rows.map((row) => row.branchId)).toEqual(["preferred", "automatic"]);
  });

  it("retains deterministic Stage 10 ordering for alternatives", () => {
    const rows = [candidate("b", false), candidate("a", false)].sort(
      comparePreferredCandidateScore,
    );
    expect(rows.map((row) => row.branchId)).toEqual(["a", "b"]);
  });
});
