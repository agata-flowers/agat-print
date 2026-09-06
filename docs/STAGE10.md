# Stage 10 — Partner Marketplace & Production Network

## Goal

Turn the existing one-partner-per-order matching and fulfillment foundation into
an operable network of moderated studios. Matching must select only a currently
eligible branch that can produce the immutable order demand, is available, has
capacity, and serves the demand location. The decision must be deterministic,
explainable and safe under concurrent configuration and offer activity.

Stage 1–9 contracts remain the baseline. Stage 10 extends `Partner`, `Branch`,
the immutable capability model and the Stage 6 offer flow; it does not introduce
a second marketplace or assignment aggregate.

## User scenarios

1. An applicant may create a draft studio profile, edit it, and submit it for
   moderation. The legacy registration endpoint continues to create a pending
   application.
2. A platform administrator may inspect applications and activate, reject,
   suspend or close a partner. Every critical transition is audited with bounded
   metadata.
3. An active partner may manage only its own public profile, branch operating
   profile, immutable capability/catalog/capacity versions and bounded
   availability exceptions.
4. A partner may temporarily stop accepting new work or disable a catalog item
   without affecting immutable historical offer and payout snapshots.
5. Matching evaluates every candidate using partner and branch lifecycle,
   service/capability compatibility, current catalog, schedule and blackout
   windows, service area, held offer reservations and active workload.
6. Operators can inspect bounded reason codes and score components for a
   matching run without seeing secrets, personal contacts or customer data.
7. Existing offer expiry/reject/retry, production, fulfillment, reprint,
   dispute and finance flows continue to operate against the accepted immutable
   offer snapshot.

## Domain and database scope

- Partner lifecycle: `DRAFT`, `PENDING`, `ACTIVE`, `SUSPENDED`, `REJECTED`,
  `CLOSED`. The legacy `APPROVED` value remains readable and matching-eligible
  for backward compatibility; new moderation uses `ACTIVE`.
- Partner profile adds bounded public description and an encrypted operational
  contact. Plain contact values are never logged, audited or used as metrics.
- Branch stores timezone, coordinates, service radius, public description and
  an `acceptingOrders` switch. Coordinates are fixed-precision decimals.
- `BranchOperationalVersion` freezes weekly hours and operational settings.
- `BranchCapabilityVersion` is extended with bounded service, paper, color,
  equipment and quantity attributes. A branch points to one current immutable
  version; superseded versions remain historical.
- `BranchCatalogVersion` and immutable items describe enabled branch-specific
  services. A new catalog version supersedes the current version atomically.
- `BranchCapacityVersion` freezes maximum concurrent work. Current workload is
  derived from active assignments plus held offer reservations, not from an
  eventually consistent counter.
- `BranchAvailabilityException` represents bounded temporary available or
  unavailable intervals.
- `MatchingCandidateEvaluation` preserves bounded reason codes, eligibility,
  rank and score components for every evaluated branch.
- `OfferCapacityReservation` holds one capacity unit until offer expiry,
  rejection or acceptance. The accepted assignment then represents workload.

All version records and candidate evaluations are append-only. Existing
`PriceSnapshot`, `PartnerPayoutSnapshot`, fiscal and ledger records remain
immutable.

## Matching and ranking contract

Hard eligibility checks, in order, are:

1. partner is `ACTIVE` or legacy `APPROVED`;
2. branch is active and accepting new orders;
3. current capability satisfies file kind, page count, dimensions, DPI,
   service, paper, color and quantity;
4. current catalog enables the required service;
5. current operating schedule or explicit availability override permits work;
6. the branch is inside its configured service area;
7. active assignments plus held reservations are below current capacity.

Every failed check produces only bounded reason codes. Eligible candidates are
ranked by capability priority, geographic distance, current workload ratio and
stable branch UUID. Identical inputs and database state therefore produce the
same order.

Offer creation locks the current capacity-version row and rechecks eligibility
before creating a held reservation, offer, immutable payout snapshot and
outbox event in one transaction. Accept locks the order and capacity state and
requires the offered capability, catalog and capacity versions still to be the
branch's current active versions. It also rechecks lifecycle, branch switch and
temporary availability. A stale or newly ineligible offer is expired safely and
cannot create an assignment. PostgreSQL still permits only one active assignment
per order.

Expiry/reject releases the held reservation idempotently before the next
candidate is evaluated. Accept consumes it exactly once. Suspension blocks new
offers and pending acceptance, but an already accepted assignment may continue
through production and fulfillment so paid customer work is not stranded.

## API and UI scope

- Partner-owned draft/submission, profile and branch workspace endpoints.
- Partner-owned immutable operating, capability, catalog and capacity version
  endpoints and availability controls; every mutation requires
  `Idempotency-Key`.
- Platform-admin application list and lifecycle moderation endpoints.
- Admin matching history includes bounded evaluation reason codes and score
  components.
- Partner workspace UI exposes onboarding, branch readiness, service/catalog,
  capacity and availability controls. Admin UI exposes moderation and network
  status. No customer-facing marketplace browser is added.
- REST remains under `/api/v1`; OpenAPI is updated without changing existing
  response contracts unnecessarily.

## Security, privacy and concurrency

- `ADMIN` moderates all partners. `PARTNER` may read or mutate only records whose
  `partnerId` belongs to the authenticated owner. A customer cannot access
  network administration endpoints.
- Operational contacts are encrypted at rest and omitted from matching,
  audit/log/metrics and public/admin list responses unless an explicitly
  authorized detail operation needs them.
- No free text, contact, coordinate, order/partner/branch ID, full URL or other
  high-cardinality value is a metric label. Audit metadata contains bounded
  operation/status/reason enums only.
- Domain mutation and outbox/audit intent are committed atomically where a
  workflow transition occurs. Idempotency stores request digests and prior
  responses; same-key/different-payload conflicts.
- Row locks, aggregate CAS, immutable version pointers, capacity reservations
  and existing unique assignment constraints cover availability changes during
  matching, concurrent offers/accepts, stale capability snapshots and double
  assignment.

## Provider and worker scope

The existing maps port is extended to a provider-neutral geo eligibility and
distance contract. CI uses a deterministic in-process implementation. Real map
providers, credentials, geocoding and route optimization are externally
blocked and are not required for Stage 10 acceptance.

The existing matching BullMQ/outbox/inbox worker dispatches expiry, retry and
network re-evaluation operations. PostgreSQL remains authoritative; repeated
delivery cannot reserve capacity, release it or advance an offer twice.

## Required tests

- Unit tests for schedule, service-area, capability/catalog and deterministic
  ranking decisions.
- Integration/API tests for draft/submission/moderation, ownership isolation,
  idempotency conflicts and safe audit payloads.
- DB-E2E tests for incompatible/disabled/unavailable/out-of-area/full-capacity
  filtering and deterministic reason codes/ranking.
- Concurrent matching at the last capacity unit, concurrent accept, double
  assignment and duplicate BullMQ delivery.
- Capability/catalog/capacity changes between offer and accept reject the stale
  offer without creating an assignment.
- Suspension prevents new work and pending acceptance while allowing an already
  accepted assignment to reach `READY`.
- No cross-partner configuration, offer, order or print-ready access.
- Stage 1–9 regression, clean and repeatable migrations, Prisma
  generate/validate, format/lint/typecheck/tests/build, Compose build/health,
  Redis/BullMQ, MinIO/processing and backup/restore checks.

## Acceptance criteria

Stage 10 is accepted only when:

- all lifecycle, ownership, immutable versioning and audit rules above are
  enforced by API and database constraints;
- matching produces persisted explainable evaluations and never offers or
  assigns an ineligible or over-capacity branch;
- races and redelivery preserve one assignment and correct capacity;
- all Stage 1–9 regression gates pass before the Stage 10 gate;
- `quality` and `infrastructure` are successful on the final `main` commit;
- `stage10-verification-report` is uploaded with `if: always()`, reports the
  real gate result, DB-E2E status and regression status, and includes measured
  backup RPO/RTO.

## Explicitly out of scope

- customer marketplace browsing, comparison or partner selection;
- delivery routing, GPS tracking or route optimization;
- subscriptions, loyalty, advertising or marketplace commissions beyond the
  existing immutable payout rules;
- new payment, OTP, fiscal or payout-provider integrations;
- document editing, new input formats or processing behavior;
- multi-partner order splitting, new matching of a Stage 8 reprint, or changes
  to accepted Stage 1–9 financial/state-machine guarantees;
- real maps/geocoding integrations without provider contracts and credentials;
- Stage 11 work.
