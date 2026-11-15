import type { PremiumService, ServiceId } from "./premium-services";

export type AssignmentOutcome =
  | "eligible"
  | "unsupported"
  | "unavailable"
  | "overloaded"
  | "outside-area";

export type AssignmentCandidate = {
  id: string;
  name: string;
  services: ServiceId[];
  equipment: string[];
  available: boolean;
  loadPercent: number;
  rating: number;
  distanceKm: number;
  radiusKm: number;
};

export type RankedCandidate = AssignmentCandidate & {
  outcome: AssignmentOutcome;
  score: number;
};

export const assignmentCandidates: AssignmentCandidate[] = [
  {
    id: "studio-chilanzar",
    name: "AGAT PRINT Chilanzar",
    services: ["id-photo", "printing", "presentations", "coursework", "design"],
    equipment: ["digital-a3", "photo-lab", "binding"],
    available: true,
    loadPercent: 38,
    rating: 4.9,
    distanceKm: 2.4,
    radiusKm: 12,
  },
  {
    id: "studio-yunusabad",
    name: "AGAT PRINT Yunusabad",
    services: ["id-photo", "printing", "outdoor", "presentations", "design"],
    equipment: ["digital-a3", "wide-format", "laminator"],
    available: true,
    loadPercent: 57,
    rating: 4.8,
    distanceKm: 4.1,
    radiusKm: 18,
  },
  {
    id: "studio-sergeli",
    name: "Print Lab Sergeli",
    services: ["printing", "outdoor", "coursework"],
    equipment: ["digital-a3", "wide-format", "binding"],
    available: true,
    loadPercent: 72,
    rating: 4.7,
    distanceKm: 7.6,
    radiusKm: 16,
  },
  {
    id: "studio-busy",
    name: "Demo Studio Busy",
    services: [
      "id-photo",
      "printing",
      "outdoor",
      "presentations",
      "coursework",
      "design",
    ],
    equipment: ["digital-a3"],
    available: true,
    loadPercent: 100,
    rating: 5,
    distanceKm: 1.1,
    radiusKm: 10,
  },
];

export const rankAssignmentCandidates = (
  service: Pick<PremiumService, "id">,
  candidates: AssignmentCandidate[] = assignmentCandidates,
): RankedCandidate[] =>
  candidates
    .map((candidate) => {
      const outcome: AssignmentOutcome = !candidate.services.includes(
        service.id,
      )
        ? "unsupported"
        : !candidate.available
          ? "unavailable"
          : candidate.loadPercent >= 95
            ? "overloaded"
            : candidate.distanceKm > candidate.radiusKm
              ? "outside-area"
              : "eligible";
      const score =
        outcome === "eligible"
          ? Math.round(
              candidate.rating * 1_000 -
                candidate.distanceKm * 40 -
                candidate.loadPercent * 3,
            )
          : -1;
      return { ...candidate, outcome, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.distanceKm - right.distanceKm ||
        left.id.localeCompare(right.id),
    );

export const eligibleAssignmentCandidates = (
  service: Pick<PremiumService, "id">,
  candidates: AssignmentCandidate[] = assignmentCandidates,
) =>
  rankAssignmentCandidates(service, candidates).filter(
    (candidate) => candidate.outcome === "eligible",
  );
