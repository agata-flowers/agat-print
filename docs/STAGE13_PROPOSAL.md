# Stage 13 proposal — Checkout Fulfillment Commitment & Delivery Pricing

Status: proposed; implementation requires separate approval.

Baseline: Stage 12 commit
`a5e3276d9983ad88a624c6bbafa4a48bf06d1982` and GitHub Actions run
`34495169708`. Stages 1–12 remain authoritative and unchanged.

Implementation clarification: Stage 13 acceptance has no external-provider
dependency. `PICKUP` is a complete first-class path with no provider call.
`DELIVERY` uses the production-capable internal deterministic Tashkent zonal
pricing, service-area and courier assignment implementation already bounded by
provider-neutral ports. External maps, geocoding, courier, payment, SMS/OTP and
fiscal credentials are neither introduced nor required by the Stage 13 gate.
Future adapters may replace only the port implementation; they must not change
the checkout contract or any historical fulfillment or price snapshot.

## Problem statement and product goal

AGAT PRINT already lets a customer configure and approve one print service,
receive a server-authoritative quote, choose or automatically receive an
eligible studio, pay, and use the Stage 7 pickup or basic-delivery machinery.
The remaining customer journey is not yet commercially coherent: pickup versus
delivery is chosen only after the partner marks the order `READY`. Consequently
the quote and immutable `PriceSnapshot` cannot include a delivery charge, and
matching cannot authoritatively use the customer's actual delivery zone before
offering the paid order to a studio.

Stage 13 closes that gap. Before quote and checkout, the customer commits to
pickup or delivery. A delivery choice contains a bounded service location and
an encrypted destination address. The existing pricing transaction includes a
versioned delivery fee, checkout freezes the choice, matching reuses it as a
hard service-area input, and the existing fulfillment state machine activates
the committed choice when production reaches `READY`.

The measurable product result is one honest end-to-end journey in which the
customer knows the complete payable total before payment and does not have to
redesign the order after production.

## Why this vertical is Stage 13

This is the largest remaining gap in the existing print-service MVP for four
reasons:

1. The PRD promises that the customer knows the price before payment, but the
   current post-`READY` delivery choice is not priced in the quote.
2. Stage 10 matching has service-area primitives, yet the actual destination is
   not frozen when matching begins. Discovery-time location is indicative and
   cannot safely substitute for an order requirement.
3. Stage 7 already provides PINs, courier isolation, encrypted addresses and
   terminal completion. Extending the pre-checkout lineage activates that
   investment without creating another delivery system.
4. Real acquiring/SMS/fiscal/maps integrations need external contracts;
   inventory-backed retail materially broadens the order model; reviews/chat do
   not unblock fulfillment. A bounded Tashkent zone-based pickup/delivery
   commitment is internally implementable and independently verifiable.

The partner multi-order console, inventory-backed stationery, reviews/chat and
vendor onboarding remain real gaps, but combining any of them with fulfillment
pricing would make this stage incoherent.

## User journeys

### Customer — pickup

1. The customer follows the existing home, catalog, configuration, upload,
   preview and approval flow.
2. Before requesting a quote, the customer chooses pickup. If a preferred
   studio exists, its public card is shown; automatic assignment remains
   available and authoritative.
3. The quote shows service lines and a zero or configured pickup line. Checkout
   freezes the fulfillment choice with the existing catalog, tariff, approval,
   studio-selection and print-ready lineage.
4. Payment, matching, offer acceptance and production use existing contracts.
5. At `READY`, the customer activates the already committed pickup intent and
   receives the existing one-time completion PIN. The partner verifies it and
   the order reaches `COMPLETED`.

### Customer — delivery

1. Before quote, the customer selects a bounded Tashkent service location and
   enters the delivery address. The address is validated and encrypted before
   persistence; coordinates are not required.
2. The quote displays the versioned integer UZS delivery fee and complete total.
3. Matching considers the frozen location as a hard service-area requirement.
   Preferred studio, allowed fallback and strict-preference behavior remain the
   Stage 12 contract.
4. At `READY`, the customer activates the committed delivery intent. Existing
   deterministic courier assignment, partner/courier handoff, encrypted address
   access and customer completion PIN take the order to `COMPLETED` or the
   existing `DELIVERY_FAILED` state.

### Partner, courier and administrator

1. A partner sees only the bounded fulfillment mode after accepting an order.
   The partner never sees the delivery address or delivery fee.
2. An assigned approved courier receives the decrypted address only through the
   existing owner-scoped active-delivery response and only while needed.
3. An administrator publishes fulfillment price rules as part of the existing
   immutable tariff version, observes bounded intent/activation states and can
   diagnose failures without viewing address plaintext.
4. Reprint uses the original immutable fulfillment selection, creates a fresh
   fulfillment cycle and PIN, and never changes the original price snapshot or
   partner payout snapshot.

## Exact in-scope

1. A required pickup/delivery preference on new customer order drafts before
   quote. Legacy drafts and orders without this lineage retain current behavior.
2. Bounded pilot `locationCode` values for delivery service eligibility and
   pricing. The initial operational scope is Tashkent and does not require
   geocoding.
3. AES-256-GCM encryption of delivery address data using the existing delivery
   data key boundary. Pickup persists no address.
4. Immutable fulfillment pricing rules under the existing `TariffVersion`, with
   integer UZS minor units and one rule per mode/location combination.
5. Server-authoritative quote and checkout validation that includes fulfillment
   preference version, tariff rule, fee and canonical request lineage.
6. One immutable order fulfillment-selection snapshot. It is an intent, not a
   second `OrderFulfillment` or state machine.
7. Matching integration that treats the frozen delivery location as a hard
   service-area input. Preferred studio remains only a priority among fully
   eligible candidates.
8. Activation of the committed intent at `READY` through the existing Stage 7
   `OrderFulfillment`, PIN, courier and delivery operations.
9. Existing Stage 8 reprint integration: same committed mode/location/address,
   new production/fulfillment cycle, new PIN, no repricing or rematching.
10. RU/UZ mobile-first selection, itemized quote, order summary, activation and
    safe recovery/error states. EN stays fallback-ready.
11. ADMIN tariff configuration and bounded fulfillment diagnostics; partner and
    courier projections are extended only where required for the journey.
12. Transactional outbox/inbox notifications for fulfillment action required,
    activation, courier assignment, delivery failure and completion.
13. OpenAPI, ERD, architecture, state-machine clarification, RBAC/threat model,
    operations, testing and recovery documentation.

## Explicitly out of scope

- A new payment, refund, fiscal, payout, OTP, maps, geocoding, notification or
  delivery-provider integration.
- GPS tracking, traffic ETA, route optimization, dynamic surge pricing,
  distance-meter billing or a courier marketplace.
- Inventory-backed stationery, SKUs, stock reservation, carts, order splitting,
  multiple fulfillment destinations or multiple partners per order.
- Cash on delivery, payment after production, tips, promo codes, loyalty,
  subscriptions or corporate billing.
- Customer address book, saved addresses, address autocomplete or storage of
  exact coordinates.
- Post-payment mode/address changes, partner-initiated rerouting or admin direct
  state overrides. Such changes require a separately designed financial and
  audit workflow.
- Partner production-workspace expansion, staff accounts, reviews, ratings,
  chat or customer support attachments.
- New document formats, editors, processing behavior or printer drivers.
- Any implementation before separate approval of this proposal.

## Domain model and database changes

All changes are additive and extend existing aggregates.

### Proposed records

- `OrderDraftFulfillmentPreference`: one owner-scoped mutable preference per
  draft; mode, bounded location code for delivery, encrypted address fields,
  key version, aggregate version and invalidation timestamps. It is protected
  by draft/version CAS.
- `OrderFulfillmentSelectionSnapshot`: one immutable checkout-time snapshot per
  order; mode, bounded location code, encrypted address fields, source draft
  preference version, fulfillment pricing rule lineage and fee in UZS. It does
  not duplicate the mutable status of `OrderFulfillment`.
- `FulfillmentTariffRule`: immutable child of the existing `TariffVersion`,
  keyed by tariff, mode and bounded location code, with integer `feeMinor`,
  enabled state and bounded service constraints where needed.

### Existing records extended

- `PriceQuote` freezes the fulfillment-preference version and selected rule in
  its lineage. Its existing line items and total include the fee.
- `PriceSnapshot` remains the single immutable customer-price truth. Its bounded
  source parameters and line items include fulfillment mode, location code and
  fee, never address plaintext/ciphertext.
- `OrderFulfillment` references the immutable selection snapshot or its order;
  it continues to be created once per `ProductionCycle` and remains the only
  fulfillment lifecycle record.
- Existing order, draft, matching, production cycle, delivery and notification
  indexes gain only the indexes needed for owned reads, activation scans and
  restore-integrity checks.

Database constraints must enforce one draft preference per draft, one immutable
selection per order, valid pickup/delivery field combinations, one pricing rule
per tariff/mode/location, non-negative integer fees and existing one-
fulfillment-per-cycle uniqueness. Immutable triggers reject update/delete of
published rules and order snapshots.

No `PriceSnapshot`, `PartnerPayoutSnapshot`, historical quote, payment, fiscal,
ledger, assignment, production, dispute or existing fulfillment row is
rewritten.

## API contracts

REST remains under `/api/v1`; exact schemas are added to OpenAPI before
implementation.

- `GET /order-drafts/{draftId}/fulfillment-options` — owner-only safe choices
  for the draft, with localized labels, bounded location codes, indicative fee
  strings and availability. It returns no address or internal IDs.
- `PUT /order-drafts/{draftId}/fulfillment-preference` — owner-only, CSRF/CAS
  and `Idempotency-Key` protected pickup or delivery selection. Delivery accepts
  bounded `locationCode` and address; pickup rejects address fields.
- `DELETE /order-drafts/{draftId}/fulfillment-preference` — owner-only
  idempotent removal before quote/checkout.
- Existing `POST /order-drafts/{draftId}/quote` revalidates and freezes the
  preference/rule. New drafts without a valid preference fail with a localized
  bounded error.
- Existing `POST /order-drafts/{draftId}/checkout` recomputes the complete total
  and creates the immutable selection snapshot in the same transaction as the
  order and `PriceSnapshot`.
- `POST /orders/{orderId}/fulfillment/activate` — owner-only idempotent
  activation of the frozen selection at `READY`; it reuses the existing
  fulfillment service and returns the one-time PIN under the existing secret
  handling contract.
- Existing `POST /orders/{orderId}/fulfillment` remains compatible for legacy
  orders without a Stage 13 snapshot. For a Stage 13 order it may only delegate
  to the frozen selection; a conflicting mode/address is rejected.
- Existing customer order/detail/timeline and notification projections add only
  localized mode, safe location label, itemized fee and bounded activation
  presentation. They never return address ciphertext, internal rule IDs or
  provider references.
- Existing admin tariff publication accepts optional bounded fulfillment rules.
  Existing payloads without rules remain valid for backwards compatibility.

Every new mutation requires `Idempotency-Key`. Byte upload and provider webhook
contracts remain unchanged.

## Web/PWA UI

- The existing draft journey gains a fulfillment step after service/layout
  approval and before quote.
- Pickup/delivery is shown with localized explanation, complete-price impact and
  the currently selected/preferred studio context.
- Delivery asks for bounded location and address once. No UUID, internal status,
  provider ID, exact coordinate or technical error is displayed.
- Quote and checkout show an itemized fulfillment line and authoritative total.
- Order status shows the committed mode and safe destination summary. At
  `READY`, one clear action activates pickup or delivery and displays the
  existing one-time PIN warning.
- Refresh, re-login, network interruption and same-key retry recover from the
  server-side preference/order. Address and PIN are never placed in
  localStorage, IndexedDB, Cache Storage, analytics or notification payloads.
- RU and UZ cover selection, validation, pricing, activation, waiting,
  unavailable-zone, stale-quote, retry and terminal states. EN uses the existing
  fallback architecture.
- Partner UI receives only mode and actionable handoff state. Courier UI keeps
  its existing just-in-time address access. Admin UI receives bounded status
  and location code, not plaintext address.

## State-machine changes

The primary `OrderStatus` state machine does not gain a competing lifecycle.
The existing path remains:

`... → IN_PRODUCTION → READY → AWAITING_PICKUP → [COURIER_ASSIGNED → IN_DELIVERY] → COMPLETED`

Stage 13 clarifies its guards:

- quote requires a valid draft fulfillment preference for new Stage 13 drafts;
- checkout freezes the preference but does not create fulfillment early;
- only `READY` can activate the frozen intent;
- pickup activation follows `READY → AWAITING_PICKUP`;
- delivery activation follows `READY → AWAITING_PICKUP`, after which the
  existing courier worker may advance to `COURIER_ASSIGNED`;
- legacy orders without a snapshot keep the Stage 7 late-selection endpoint;
- reprint returns to `READY`, then activates the same immutable intent for the
  new cycle with a new PIN;
- `DELIVERY_FAILED`, `COMPLETED`, dispute, refund and retention semantics remain
  unchanged.

Direct status writes and skipped/reverse transitions remain forbidden.

## Security, privacy and RBAC

- CUSTOMER may read or mutate only its own draft preference and activate only
  its own ready order. Foreign resources remain indistinguishable from missing
  resources where existing conventions require it.
- PARTNER sees only assigned orders and bounded fulfillment mode; it never sees
  delivery address or customer contact data.
- COURIER sees decrypted address only for its current assigned active delivery.
  Suspension/reassignment removes access immediately.
- ADMIN may publish pricing rules and inspect bounded operational status, but
  ordinary list/audit endpoints do not return address plaintext.
- Address plaintext is validated, encrypted immediately with AES-256-GCM and a
  secret-store key, zeroed from transient buffers where practical, and excluded
  from logs, audit, metrics, errors, idempotency responses and outbox payloads.
- PINs retain HMAC-only storage, attempt ceilings, TTL, context separation and
  one-time CAS. A PIN is never persisted in an idempotency record.
- Quote, order, fulfillment, address and API responses are `Cache-Control:
no-store, private`; the PWA service worker remains network-only.
- No address, coordinates, phone, PIN, signed URL, object key, provider
  reference, order/draft/user ID or user text appears in metric labels. Audit
  metadata is limited to bounded mode, result, state and location-class enums.
- Production startup remains fail-closed without delivery encryption key and
  required real provider configuration. No development secret is introduced.

## Reliability, idempotency and concurrency

- Preference mutation, quote, checkout and activation use PostgreSQL
  transactions, aggregate-version CAS and the established idempotency service.
  Same key plus same canonical payload replays; changed payload conflicts.
- Preference-versus-preference and preference-versus-quote races yield one
  version-consistent result. A quote cannot mix an old address/rule with a new
  preference.
- Tariff publication racing quote/checkout either freezes one current complete
  version or returns a bounded stale conflict; it never mixes service and
  fulfillment rules from different tariff versions.
- Checkout locks and revalidates draft, approval, quote, tariff, studio choice
  and fulfillment lineage and creates at most one order, price snapshot and
  fulfillment-selection snapshot.
- Matching consumes only the immutable order snapshot. Discovery-time location
  and browser price are never authoritative.
- Two activation requests create one `OrderFulfillment` for the current cycle.
  Safe replay returns the same semantic result without storing the PIN in
  plaintext; changed mode/address is rejected.
- Courier assignment, partner handoff, completion and failure retain existing
  row locks, unique active delivery, CAS, outbox and inbox deduplication.
- A reprint activation is keyed by the new production cycle, so an old PIN,
  fulfillment or redelivered job cannot authorize the new cycle.
- BullMQ remains transport only. PostgreSQL outbox/inbox, leases and unique
  constraints are authoritative through crash and redelivery.

## Observability and audit

- Bounded metrics may include route template, method, response class, role,
  fulfillment mode, bounded location class, activation result and domain state.
- Alerts cover stale fulfillment quote rate, unsupported location, activation
  dead letters, courier-assignment exhaustion, delivery failure and restore
  integrity without high-cardinality labels.
- Safe audit events cover preference set/cleared, fulfillment rule publication,
  checkout snapshot creation and activation. They contain bounded enums only.
- Request IDs remain log correlation values and never metric labels. Logs do not
  contain request bodies for fulfillment/address routes.

## Migrations, backward compatibility and rollback

1. Add enums, tables, nullable foreign keys, checks, indexes and immutable
   triggers in one forward migration. Existing rows are not backfilled with
   invented fulfillment choices.
2. API reads legacy drafts/orders with null Stage 13 lineage and retains the
   Stage 7 late-selection flow for them.
3. Publish a tariff version containing fulfillment rules before enabling the
   new draft requirement. Existing tariff payloads remain readable.
4. Gate new draft preference, quote requirement and matching consumption behind
   independently reversible feature flags.
5. Enable pickup first, then bounded-zone delivery after operational checks.

Rollback disables new entry points and creation of Stage 13 drafts. Existing
snapshots remain readable and fulfillable; tables and immutable history are not
dropped. Database rollback is forward-fix only after data exists. No rollback
may rewrite a `PriceSnapshot` or fulfillment selection.

## Test strategy

### Unit

- pickup/delivery field-combination validation and bounded location policy;
- integer fulfillment fee calculation and existing price-line composition;
- canonical preference/quote/activation idempotency hashes;
- RU/UZ labels, safe summaries and error mapping;
- service-area matching input and Stage 12 preferred/fallback ordering;
- PIN non-persistence and metric/audit allow-lists.

### Integration/API

- owner isolation, CUSTOMER/PARTNER/COURIER/ADMIN RBAC and no-store headers;
- fulfillment rule publication with legacy tariff payload compatibility;
- encrypted address persistence and redacted projections;
- preference replay/conflict, clearing, stale quote and authoritative checkout;
- legacy order endpoint compatibility;
- reprint reuse and fresh-PIN behavior;
- safe outbox/notification payloads and replay.

### DB-E2E and concurrency

- pickup and delivery quotes include the exact immutable rule and integer total;
- tariff changes do not mutate existing quotes/snapshots and stale checkout is
  rejected;
- all four input formats retain the Stage 11 customer flow with fulfillment;
- preferred, fallback and strict matching honor the frozen delivery zone;
- out-of-zone/full/suspended/incompatible studios never receive offers;
- concurrent preference/quote, quote/checkout and activation requests preserve
  one consistent lineage and one fulfillment;
- courier assignment/handoff/completion and failure remain idempotent;
- reprint creates a new fulfillment and PIN while preserving price/payout;
- no address/PIN/IDs/provider/storage data leaks to logs, audit or metrics;
- immutable triggers and backup/restore integrity reject corruption.

### Playwright E2E

At least one RU mobile cross-role pickup journey must use the real UI and
internal APIs:

`catalog → configuration → upload → processing/layout → approval → pickup →
quote → checkout → payment → matching/accept → production/ready → activate →
PIN handoff → completed timeline/history`.

A focused UZ delivery journey verifies localized selection, bounded location,
itemized fee, reload/re-login recovery and safe order presentation. Delivery
completion may use the existing deterministic CI provider and courier UI; it
must not bypass domain endpoints or database constraints.

Browser assertions must prove that internal UUIDs/statuses, address plaintext
outside the authorized form/courier moment, PIN after its one-time display,
provider data, payout and storage identifiers are absent.

## Regression, infrastructure and CI requirements

- Frozen clean install, format, lint, typecheck, unit/integration tests and
  production build.
- Prisma generate/validate, migration on a clean PostgreSQL database and
  repeated `migrate deploy` with no pending changes.
- Sequential full Stage 1–12 regression before the Stage 13 gate.
- Stage 13 DB-E2E, Playwright, security/privacy/RBAC/idempotency/concurrency and
  feature-flag compatibility gates.
- Docker Compose config/build/up and health for PostgreSQL, Redis/BullMQ, MinIO,
  ClamAV, processing, API, Web, printer-agent and backup/restore services.
- Existing isolated processing, signed URL, secret validation, payment/finance,
  matching/capacity, fulfillment/PIN, dispute/reprint, retention/legal-hold and
  notification guarantees remain green.
- `stage13-verification-report` is initialized before the gate and uploaded with
  `if: always()`. A failed assertion still fails the job.
- The successful report records final SHA, Stage 1–12 regression, DB/browser
  E2E, migration, security/concurrency, backup/restore, measured RPO/RTO and an
  evidence SHA-256; its sidecar and artifact digest are verified.

## Backup and restore requirements

PostgreSQL backup includes fulfillment preferences, immutable selections,
pricing-rule lineage and encrypted addresses. Financial/legal records remain
subject to existing legal-retention rules and are not automatically deleted.
Object manifest scope, legal holds, tombstone replay and MinIO checksum checks
remain unchanged.

An isolated restore must prove:

- every Stage 13 order has at most one immutable selection snapshot;
- snapshot, quote and price totals/rules agree;
- delivery ciphertext authenticates with its key version and pickup has no
  address fields;
- active fulfillment points to the current production cycle and one order has
  no conflicting active delivery;
- reprint cycles cannot reuse prior PIN state;
- legacy null-lineage orders remain readable;
- API/workers stay disabled until integrity, tombstones and legal holds pass.

Pilot targets remain RPO at most 24 hours and RTO at most 4 hours; CI and the
monthly drill record measured values rather than restating targets as facts.

## Acceptance criteria

Stage 13 is accepted only when all of the following hold on one final `main`
SHA:

1. Every new quote/checkout has one valid pickup or delivery preference; legacy
   drafts/orders retain Stage 7 behavior.
2. The customer sees the complete server-authoritative integer UZS total,
   including the immutable fulfillment fee, before payment.
3. Checkout freezes one immutable fulfillment-selection snapshot and never
   rewrites `PriceSnapshot` or `PartnerPayoutSnapshot`.
4. Delivery address is encrypted at rest and absent from price, matching,
   audit, logs, metrics, notifications, browser persistence and unauthorized
   API responses.
5. Matching uses the frozen delivery location and never bypasses lifecycle,
   capability, catalog, hours, service area, capacity, preference fallback,
   offer TTL or accept revalidation.
6. Preferred studio is prioritized only when eligible; allowed fallback is
   deterministic; strict unavailability reaches the existing single-refund
   path without creating an incompatible offer.
7. Activation at `READY` creates one existing `OrderFulfillment` for the current
   cycle. Retry/race cannot create a second fulfillment or expose/store a PIN.
8. Pickup and delivery reach the existing valid terminal states through PIN,
   courier and provider-neutral domain boundaries; reverse/skipped transitions
   fail.
9. Reprint reuses the immutable fulfillment selection, creates a new cycle and
   PIN, and does not reprice, rematch or create a new payout snapshot.
10. Customer, partner, courier and admin projections enforce RBAC/ownership and
    expose only the minimum role-appropriate data.
11. RU/UZ customer flows are complete, mobile-first, resumable and use bounded
    localized errors; EN remains fallback-ready.
12. Unit/integration tests, Stage 13 DB-E2E and both required Playwright flows
    pass, including negative, concurrency, replay and privacy cases.
13. Prisma validation/generation, clean/repeated migration, production build,
    Docker infrastructure and the complete Stage 1–12 regression chain pass.
14. Encrypted backup and isolated restore validate Stage 13 lineage and all
    prior object/tombstone/legal-hold guarantees with measured RPO/RTO.
15. GitHub Actions `quality` and `infrastructure` are successful, the final
    working tree is clean and synchronized with `origin/main`, and the verified
    `stage13-verification-report` reports success for that exact SHA.

## Risks and mitigations

| Risk                                                        | Mitigation                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Collecting address earlier increases privacy exposure       | Encrypt immediately, minimize fields, no client persistence, just-in-time courier disclosure            |
| Flat zone fee differs from actual courier cost              | Immutable bounded pilot rules, explicit admin publication and reconciliation; no silent repricing       |
| Service-area data changes after payment                     | Match/accept revalidation against immutable demand; fallback/refund remains authoritative               |
| Concurrent preference, quote and tariff changes mix lineage | Row locks, aggregate CAS, canonical hashes and one-transaction snapshot creation                        |
| Customer loses one-time PIN                                 | Existing deterministic nonce/HMAC recovery contract; no plaintext persistence or support-log disclosure |
| Delivery provider unavailable                               | Pickup remains operable; delivery fails closed through existing state and provider boundary             |
| Reprint accidentally reuses old authorization               | Fulfillment/PIN uniqueness is scoped to the new production cycle                                        |
| Legacy orders regress                                       | Nullable additive lineage, compatibility endpoint behavior and full Stage 1–12 regression               |

## External blockers and dependencies

- A contracted courier adapter may replace the internal deterministic delivery
  adapter after separate certification, but is not a Stage 13 runtime or
  acceptance dependency.
- Exact-address validation, geocoding, road distance and ETA require a maps
  provider contract, credentials and privacy assessment. They are not required
  for the bounded Tashkent zone model.
- Production SMS/OTP, acquiring, fiscal, payout and outbound notification
  providers retain the Stage 9 fail-closed blockers.
- Legal review must approve address purpose/consent, processor list, retention,
  delivery terms, failed-delivery responsibility and customer wording.
- Operations must approve bounded location codes, delivery fees, service areas,
  courier coverage and escalation procedures before enabling delivery.

Both pickup and deterministic zonal delivery satisfy the Stage 13 internal MVP
journey without external providers. Only optional vendor-specific delivery and
maps behavior remains uncertified until relevant contracts and credentials are
supplied.

## Proposed deliverables

- Approved Stage 13 scope/acceptance document and PRD/ADR/ERD/state-machine,
  OpenAPI, RBAC/threat-model, operations/testing/recovery updates.
- One additive Prisma migration with constraints, indexes and immutable
  triggers.
- Fulfillment preference and pricing extensions in the existing Ordering,
  Commerce, Matching and Fulfillment modules.
- RU/UZ customer journey updates plus bounded partner/courier/admin views.
- Outbox/inbox notification and activation work using existing workers.
- Unit, integration, DB-E2E, Playwright and security/concurrency tests.
- `ops/verify/stage13.sh`, sequential Stage 1–12 regression integration and an
  always-uploaded machine-readable verification artifact.

## Proposed implementation sequence

1. Reconfirm the accepted Stage 12 baseline and commit this proposal only.
2. After separate approval, update architecture/OpenAPI contracts and add the
   additive schema, migration, checks, triggers and restore-integrity queries.
3. Extend the existing tariff publication and integer pricing calculation.
4. Implement owner-scoped encrypted draft preference and immutable checkout
   snapshot without changing legacy behavior.
5. Feed the snapshot into the existing matcher/service-area evaluation.
6. Implement `READY` activation by composing the existing fulfillment/PIN/
   courier services and reprint cycle rules.
7. Add safe timeline/notification projections and bounded observability.
8. Build RU/UZ customer UI and minimal partner/courier/admin extensions.
9. Add unit/integration and focused security/concurrency tests.
10. Add Stage 13 DB-E2E and cross-role Playwright pickup/delivery journeys.
11. Update PRD, architecture, ERD, state machine, OpenAPI, security, operations
    and testing documentation.
12. Run the available local quality gate, then clean/repeated migration,
    infrastructure, regression, backup/restore and RPO/RTO verification in CI.
13. Commit implementation in logical units, push `main`, fix root causes until
    one final SHA has green `quality`, `infrastructure` and a verified Stage 13
    artifact.

No Stage 13 production/domain implementation is authorized by this proposal.
