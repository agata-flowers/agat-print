import type { MatchingReasonCode, PartnerStatus } from "@prisma/client";

export type WeeklyWindow = {
  weekday: number;
  opensMinute: number;
  closesMinute: number;
};

export type NetworkCandidate = {
  partnerStatus: PartnerStatus;
  branchActive: boolean;
  acceptingOrders: boolean;
  capabilityCompatible: boolean;
  serviceEnabled: boolean;
  withinHours: boolean;
  availability: "DEFAULT" | "AVAILABLE" | "UNAVAILABLE";
  withinServiceArea: boolean;
  workload: number;
  capacity: number;
};

export const activePartnerStatuses: PartnerStatus[] = ["ACTIVE", "APPROVED"];

export function distanceMeters(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = radians(destination.latitude - origin.latitude);
  const longitudeDelta = radians(destination.longitude - origin.longitude);
  const originLatitude = radians(origin.latitude);
  const destinationLatitude = radians(destination.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function localWeekdayAndMinute(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value;
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdays[read("weekday") ?? ""];
  const hour = Number(read("hour"));
  const minute = Number(read("minute"));
  if (
    weekday === undefined ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  )
    return null;
  return { weekday, minute: hour * 60 + minute };
}

export function isOpenAt(windows: WeeklyWindow[], now: Date, timezone: string) {
  const local = localWeekdayAndMinute(now, timezone);
  if (!local) return false;
  return windows.some(
    (window) =>
      window.weekday === local.weekday &&
      window.opensMinute <= local.minute &&
      local.minute < window.closesMinute,
  );
}

export function evaluateNetworkCandidate(candidate: NetworkCandidate) {
  const reasons: MatchingReasonCode[] = [];
  if (!activePartnerStatuses.includes(candidate.partnerStatus))
    reasons.push("PARTNER_NOT_ACTIVE");
  if (!candidate.branchActive) reasons.push("BRANCH_INACTIVE");
  if (!candidate.acceptingOrders) reasons.push("ORDERS_DISABLED");
  if (!candidate.capabilityCompatible) reasons.push("CAPABILITY_MISMATCH");
  if (!candidate.serviceEnabled) reasons.push("SERVICE_DISABLED");
  if (candidate.availability === "UNAVAILABLE")
    reasons.push("TEMPORARILY_UNAVAILABLE");
  else if (candidate.availability !== "AVAILABLE" && !candidate.withinHours)
    reasons.push("OUTSIDE_WORKING_HOURS");
  if (!candidate.withinServiceArea) reasons.push("OUTSIDE_SERVICE_AREA");
  if (candidate.workload >= candidate.capacity) reasons.push("CAPACITY_FULL");
  return reasons.length === 0
    ? (["ELIGIBLE"] as MatchingReasonCode[])
    : reasons;
}

export function compareCandidateScore(
  left: {
    priority: number;
    distanceMeters: number;
    workloadBasisPoints: number;
    branchId: string;
  },
  right: {
    priority: number;
    distanceMeters: number;
    workloadBasisPoints: number;
    branchId: string;
  },
) {
  return (
    left.priority - right.priority ||
    left.distanceMeters - right.distanceMeters ||
    left.workloadBasisPoints - right.workloadBasisPoints ||
    left.branchId.localeCompare(right.branchId)
  );
}
