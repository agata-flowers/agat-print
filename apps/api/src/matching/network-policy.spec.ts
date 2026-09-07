import { describe, expect, it } from "vitest";
import {
  compareCandidateScore,
  distanceMeters,
  evaluateNetworkCandidate,
  isOpenAt,
} from "./network-policy";

describe("stage 10 network policy", () => {
  it("uses deterministic geographic distance and ranking", () => {
    expect(
      distanceMeters(
        { latitude: 41.311081, longitude: 69.240562 },
        { latitude: 41.311081, longitude: 69.240562 },
      ),
    ).toBe(0);
    const candidates = [
      {
        priority: 10,
        distanceMeters: 100,
        workloadBasisPoints: 0,
        branchId: "b",
      },
      {
        priority: 10,
        distanceMeters: 100,
        workloadBasisPoints: 0,
        branchId: "a",
      },
      {
        priority: 20,
        distanceMeters: 1,
        workloadBasisPoints: 0,
        branchId: "c",
      },
    ];
    expect(
      candidates.sort(compareCandidateScore).map((item) => item.branchId),
    ).toEqual(["a", "b", "c"]);
  });

  it("evaluates timezone hours and explicit availability", () => {
    const atNoon = new Date("2026-09-07T07:00:00.000Z");
    expect(
      isOpenAt(
        [{ weekday: 1, opensMinute: 600, closesMinute: 1080 }],
        atNoon,
        "Asia/Tashkent",
      ),
    ).toBe(true);
    expect(
      evaluateNetworkCandidate({
        partnerStatus: "ACTIVE",
        branchActive: true,
        acceptingOrders: true,
        capabilityCompatible: true,
        serviceEnabled: true,
        withinHours: false,
        availability: "AVAILABLE",
        withinServiceArea: true,
        workload: 0,
        capacity: 1,
      }),
    ).toEqual(["ELIGIBLE"]);
  });

  it("returns bounded reasons for every hard-filter failure", () => {
    expect(
      evaluateNetworkCandidate({
        partnerStatus: "SUSPENDED",
        branchActive: false,
        acceptingOrders: false,
        capabilityCompatible: false,
        serviceEnabled: false,
        withinHours: false,
        availability: "UNAVAILABLE",
        withinServiceArea: false,
        workload: 2,
        capacity: 2,
      }),
    ).toEqual([
      "PARTNER_NOT_ACTIVE",
      "BRANCH_INACTIVE",
      "ORDERS_DISABLED",
      "CAPABILITY_MISMATCH",
      "SERVICE_DISABLED",
      "TEMPORARILY_UNAVAILABLE",
      "OUTSIDE_SERVICE_AREA",
      "CAPACITY_FULL",
    ]);
  });
});
