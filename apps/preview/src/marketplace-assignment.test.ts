import { describe, expect, it } from "vitest";
import {
  eligibleAssignmentCandidates,
  rankAssignmentCandidates,
  type AssignmentCandidate,
} from "./marketplace-assignment";

const candidates: AssignmentCandidate[] = [
  {
    id: "busy",
    name: "Busy",
    services: ["printing"],
    equipment: [],
    available: true,
    loadPercent: 100,
    rating: 5,
    distanceKm: 1,
    radiusKm: 10,
  },
  {
    id: "far",
    name: "Far",
    services: ["printing"],
    equipment: [],
    available: true,
    loadPercent: 20,
    rating: 5,
    distanceKm: 20,
    radiusKm: 10,
  },
  {
    id: "beta",
    name: "Beta",
    services: ["printing"],
    equipment: [],
    available: true,
    loadPercent: 50,
    rating: 4.8,
    distanceKm: 4,
    radiusKm: 10,
  },
  {
    id: "alpha",
    name: "Alpha",
    services: ["printing"],
    equipment: [],
    available: true,
    loadPercent: 20,
    rating: 4.9,
    distanceKm: 3,
    radiusKm: 10,
  },
];

describe("automatic service assignment ranking", () => {
  it("filters ineligible studios and ranks deterministically", () => {
    expect(
      eligibleAssignmentCandidates({ id: "printing" }, candidates).map(
        ({ id }) => id,
      ),
    ).toEqual(["alpha", "beta"]);
    expect(
      rankAssignmentCandidates({ id: "printing" }, candidates).map(
        ({ id, outcome }) => [id, outcome],
      ),
    ).toEqual([
      ["alpha", "eligible"],
      ["beta", "eligible"],
      ["busy", "overloaded"],
      ["far", "outside-area"],
    ]);
  });

  it("returns an empty queue when no candidate supports the service", () => {
    expect(eligibleAssignmentCandidates({ id: "design" }, candidates)).toEqual(
      [],
    );
  });
});
