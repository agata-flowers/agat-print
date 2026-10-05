# Stage 14 Proposal — Payments, Order Confirmation & MVP Purchase Flow

Status: proposed; implementation requires separate approval.

## 1. Current repository and baseline verification

The immutable implementation baseline is Stage 13 commit
`5e0619bb59b3c32f4478ea8a87a71af0700e6984`. At proposal preparation time:

- local `HEAD`, `main` and `origin/main` resolve to that exact commit;
- `main...origin/main` divergence is `0/0` and the tracked working tree is
  clean before this document is added;
- GitHub Actions run `34709600603` completed with `quality=success` and
  `infrastructure=success`;
- the sequential Stage 1–13 infrastructure chain passed, including Stage 13
  DB-E2E `5/5`, RU pickup and UZ delivery Playwright `2/2`, clean/repeated
  migrations, encrypted backup, isolated restore, RPO 6 seconds and RTO 5
  seconds;
- Stage 13 verification artifact `10303586019` belongs to the baseline commit.

Stage 1–13 behavior, migrations and accepted security guarantees are inputs to
this proposal, not implementation to be replaced.

### Existing contracts that Stage 14 must reuse

- Stage 11 checkout already creates exactly one `Order` in
  `AWAITING_PAYMENT`, consumes one authoritative `PriceQuote` and writes one
  immutable `PriceSnapshot`.
- Stage 12 writes one immutable `OrderStudioSelectionSnapshot`; it represents
  the customer's preference/fallback contract, not a guaranteed assignment.
- Stage 13 writes one immutable `OrderFulfillmentSelectionSnapshot` containing
  pickup/delivery, bounded zone, encrypted address and tariff lineage.
- Stage 5 already owns `Payment`, `PaymentStatus`, `ProviderCallback`, signed
  mock callbacks, refunds and the order transition `AWAITING_PAYMENT → PAID`.
- Stage 9 already provides the `PaymentProvider` port, raw-body authenticated
  HTTP webhook adapter, fail-closed production configuration, fiscal records,
  partner ledger, settlement and financial reconciliation.
- `PAYMENT_SUCCEEDED` already enters the transactional outbox and the existing
  matching/production/fulfillment pipeline. Stage 14 must not introduce a
  second order, payment, matching or fulfillment state machine.

### Conflicts and gaps found in the current implementation

The requested vertical partly overlaps Stage 5 and Stage 9. Creating new
parallel `Payment`, webhook, refund or reconciliation aggregates would violate
the architecture. Stage 14 instead extends them in place.

The actual remaining product and reliability gaps are:

1. the customer UI does not provide a complete payment-method, processing,
   failure, pending and refresh-recovery journey;
2. `Payment` stores only the latest provider reference and has no durable
   history for multiple attempts;
3. provider start currently occurs before the database records a durable
   attempt, leaving a crash window between external creation and local commit;
4. the aggregate status lacks explicit `PROCESSING`, `UNKNOWN` and `CANCELLED`
   representations needed for recovery;
5. callback history is deduplicated, but is not linked to a first-class
   payment attempt or a bounded processing disposition;
6. reconciliation exists for finance administrators, but ambiguous customer
   attempts do not yet have an automatic, durable reconciliation schedule;
7. the current development mock exposes test mechanics rather than a minimal
   customer-safe payment-method contract.

## 2. Objective

Close the MVP purchase gap by letting a customer move from an immutable Stage
13 checkout to an authoritative payment result and then into the existing
production lifecycle. The result must be recoverable after refresh, disconnect,
duplicate requests, callbacks, worker restarts and ambiguous provider results.

Stage 14 acceptance must not depend on real acquiring, OTP, fiscal, maps,
courier or SMS credentials. A deterministic internal adapter supports local,
CI and demonstration environments. Production remains fail-closed unless an
explicitly configured production adapter and secrets are present; there is no
automatic fallback to the internal adapter.

## 3. Current gap analysis and user value

After Stage 13 a customer can prepare, price and freeze a pickup or delivery
order, but the browser journey does not safely carry that order through an
observable payment attempt and authoritative confirmation. Stage 14 provides:

`draft → approved layout → fulfillment commitment → authoritative quote →`
`checkout snapshot → method selection → payment processing → authoritative`
`result → PAID → existing matching/production/fulfillment → COMPLETED`.

The customer sees the complete immutable total before payment, never sees a
fake success page, and can close or reload the browser without losing the
purchase state.

## 4. Domain model

### Reused aggregates

- `Order` remains the only order aggregate. `AWAITING_PAYMENT` means checkout
  is frozen but the commercial commitment is not confirmed; `PAID` is the
  authoritative confirmation that may start matching.
- `PriceSnapshot`, `OrderStudioSelectionSnapshot` and
  `OrderFulfillmentSelectionSnapshot` remain the immutable checkout lineage.
- `Payment` remains one per order and is the summary/coordination aggregate.
- `ProviderCallback` remains the provider-event inbox and replay record.
- `RefundOperation`, `FiscalOperation`, `FinancialJob` and
  `FinancialReconciliation` remain authoritative for their existing concerns.

### New `PaymentAttempt`

A payment may have several sequential attempts, while only one unresolved
attempt may exist at a time. Each attempt records:

- owning `paymentId` and monotonically increasing `sequence`;
- bounded method kind and configured provider code;
- integer `amountMinor`, `currency=UZS` and immutable price-snapshot digest;
- stable merchant attempt reference used as provider idempotency/correlation;
- optional provider-reference ciphertext or separately protected value plus a
  non-secret digest for lookup/operations;
- status, aggregate version, expiry/reconciliation times and bounded failure
  category;
- created/started/completed/cancelled timestamps.

Attempt source fields are immutable. Only the status/version, bounded error and
operational timestamps may advance through guarded transitions.

### Payment method representation

No stored-card or card-credential table is added. A bounded
`PaymentMethodKind` enum is stored on the attempt:

- `INTERNAL_MVP` — deterministic development/CI/demo adapter;
- `PROVIDER_REDIRECT` — provider-hosted future acquiring flow.

Available methods are deployment capabilities returned by the provider port.
Provider brands remain adapter/configuration data and do not enter core order
logic. `INTERNAL_MVP` is rejected when `NODE_ENV=production`.

### Provider event representation

`ProviderCallback` is extended rather than replaced. It becomes the immutable
normalized event ledger linked to an optional attempt and stores only:

- provider and bounded external-event identifier/digest;
- raw-payload SHA-256, never raw payload;
- normalized bounded outcome;
- processing disposition (`APPLIED`, `DUPLICATE`, `OUT_OF_ORDER`,
  `IGNORED_UNKNOWN`, `RECONCILIATION_REQUIRED`);
- safe result code and received/processed timestamps.

Invalidly authenticated input is rejected before persistence, preventing an
attacker from filling the event ledger.

## 5. Payment state machine

### Payment aggregate

`PENDING → PROCESSING → SUCCEEDED`

Non-success branches:

- `PENDING|PROCESSING → FAILED` — provider gave an authoritative failure; a
  new attempt may be created;
- `PENDING → CANCELLED` — no provider-side processing/charge exists; a new
  attempt may be created;
- `PROCESSING → UNKNOWN` — timeout, disconnect or contradictory result;
- `UNKNOWN → PROCESSING|SUCCEEDED|FAILED|CANCELLED` only through durable
  reconciliation;
- existing `SUCCEEDED → REFUND_PENDING → PARTIALLY_REFUNDED|REFUNDED` remains
  unchanged.

`SUCCEEDED`, `PARTIALLY_REFUNDED` and `REFUNDED` never regress. `FAILED` and
`CANCELLED` describe the latest completed attempt while the owning order stays
`AWAITING_PAYMENT` and may start another attempt.

### Attempt state

`CREATED → PROCESSING → SUCCEEDED|FAILED|UNKNOWN`

`CREATED → CANCELLED` is allowed before provider submission. `UNKNOWN` is
resolved only by authenticated event or reconciliation. A partial unique index
allows at most one `CREATED`, `PROCESSING` or `UNKNOWN` attempt per payment.

Out-of-order rules are monotonic:

- an exact duplicate event replays the stored result;
- `SUCCEEDED` dominates later failure/cancel events and is never downgraded;
- a success arriving after the same attempt was marked failed/cancelled, or
  after another attempt started, creates `UNKNOWN`/reconciliation-required
  state and blocks production until authoritative reconciliation;
- mismatched amount, currency, merchant reference or provider reference never
  updates the order and creates a bounded reconciliation incident;
- unknown event types are authenticated, hashed, recorded as ignored and
  return a provider-safe acknowledgement without exposing internals.

## 6. Checkout and order transitions

1. Existing Stage 11/13 checkout transaction revalidates draft, catalog,
   layout approval, quote, tariff, studio-preference and fulfillment lineage.
2. It creates/replays one `Order(AWAITING_PAYMENT)`, `PriceSnapshot`, studio
   snapshot and fulfillment snapshot. This is customer confirmation of the
   immutable order contents, but not payment confirmation.
3. Starting payment locks the order/payment, verifies ownership and checks
   that the immutable snapshots agree on currency/total and remain structurally
   valid. Retirement of a tariff after checkout does not rewrite or silently
   reprice an existing snapshot.
4. A `PaymentAttempt(CREATED)` and provider-submit outbox event are committed
   atomically before any provider call.
5. The worker calls the configured provider with the stable attempt reference
   and idempotency key, then CAS-advances the attempt/payment to `PROCESSING`.
6. Only an authenticated normalized event or reconciliation may atomically set
   `Payment=SUCCEEDED`, `Order=PAID` and write `PAYMENT_SUCCEEDED` to the outbox.
7. Existing matching consumes that event. Existing uniqueness, inbox and CAS
   protections prevent duplicate matching, production cycles, fulfillment,
   PINs, fiscal operations and ledger entries.

No mutable browser value is used for amount, currency, studio, delivery zone,
address, layout or production configuration.

### Changes while payment is active

- A checked-out draft/order cannot be edited. A changed source, approval,
  catalog, fulfillment or studio preference requires a new valid draft/order;
  it cannot mutate the active order.
- Before provider submission the attempt validates its captured snapshot
  digest. A mismatch fails closed.
- Preferred-studio eligibility is rechecked without reserving capacity before
  payment. Capacity is still authoritatively reserved by existing matching
  after `PAID`; holding production capacity throughout external payment would
  violate Stage 10 capacity semantics.
- If a strict studio or delivery service area becomes unavailable after
  payment, existing strict matching exhaustion and the single idempotent refund
  flow apply. `ALLOW_ELIGIBLE_ALTERNATIVE` may use existing deterministic
  fallback. No silent preference-policy change is allowed.

## 7. Database and Prisma changes

All changes are additive and forward-only.

### Enums

- Extend `PaymentStatus` with `PROCESSING`, `UNKNOWN`, `CANCELLED`.
- Add `PaymentAttemptStatus`: `CREATED`, `PROCESSING`, `SUCCEEDED`, `FAILED`,
  `UNKNOWN`, `CANCELLED`.
- Add `PaymentMethodKind`: `INTERNAL_MVP`, `PROVIDER_REDIRECT`.
- Add `PaymentEventDisposition`: `APPLIED`, `DUPLICATE`, `OUT_OF_ORDER`,
  `IGNORED_UNKNOWN`, `RECONCILIATION_REQUIRED`.

### `PaymentAttempt` table

| Property           | Contract                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| Purpose/owner      | Attempt history owned by one `Payment`; customer ownership is derived through `Payment.order.userId`.     |
| Lifecycle          | Append attempt, CAS status forward, retain with financial records.                                        |
| Immutable fields   | payment, sequence, method, provider, amount, currency, snapshot digest, merchant reference, created time. |
| Unique constraints | `(paymentId, sequence)`, merchant attempt reference, optional provider reference/digest.                  |
| Concurrency        | Partial unique index for one unresolved attempt per payment; `version` CAS.                               |
| Indexes            | `(paymentId, createdAt)`, `(status, nextReconcileAt)`, provider-reference digest.                         |
| Foreign keys       | `paymentId → Payment(id) ON DELETE RESTRICT`.                                                             |
| Retention          | No automatic deletion until financial/legal retention is approved.                                        |

The database adds money checks (`amountMinor > 0`, `currency='UZS'`) and a
trigger preventing changes to source fields.

### Existing `Payment`

- Add the status enum values and optional bounded `lastFailureCode` and
  `nextReconcileAt` operational fields.
- Preserve `orderId UNIQUE`, amount, currency, provider and existing refund/
  fiscal relations.
- Add relation to attempts and an index on `(status, nextReconcileAt)`.
- A trigger preserves order, amount, currency and creation provenance.

### Existing `ProviderCallback`

- Add nullable `paymentAttemptId` for legacy compatibility, normalized event
  type, disposition, safe result code and processed timestamp.
- Keep `(provider,eventId) UNIQUE` and `payloadHash` replay conflict checks.
- Add `(paymentAttemptId, createdAt)` and `(disposition, createdAt)` indexes.
- Add `paymentAttemptId → PaymentAttempt(id) ON DELETE RESTRICT`.
- Do not persist provider secrets, card data, raw request body or unrestricted
  provider error text.

### Existing reconciliation/job records

No parallel reconciliation table is introduced. `FinancialReconciliation`
continues to store payment mismatch runs; `FinancialJob` and outbox/inbox gain
bounded attempt reconciliation operations and stable deduplication keys.

### Migration and backfill

- Existing `Payment` rows retain their statuses and remain readable.
- Where a legacy payment has a provider reference, create one sequence-1
  `PaymentAttempt` using its immutable amount/currency/provider and a
  `LEGACY_IMPORT`-derived merchant reference/digest. Map `PENDING`, `SUCCEEDED`,
  `FAILED` and refund states deterministically; no provider calls occur.
- Existing callbacks keep `paymentAttemptId=NULL` unless a unique legacy
  payment-reference match can be established in the same migration without
  ambiguity.
- Legacy orders without `Payment` remain readable. An owned
  `AWAITING_PAYMENT` order can create its first attempt after normal snapshot
  eligibility checks; terminal/production orders cannot.
- Backfill is transactional, bounded and repeatable. Migration SQL includes
  post-backfill uniqueness and lineage assertions.
- No Stage 1–13 row, snapshot, provider reference, refund, fiscal entry or
  ledger entry is rewritten destructively.

## 8. API and OpenAPI changes

All routes remain under `/api/v1`, use existing error envelopes and return
`Cache-Control: no-store, private`. OpenAPI is updated before implementation.

### Customer routes

| Route                                    | Contract                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /orders/{orderId}/payment-methods`  | Owner-only safe methods available for this payable order; localized labels and bounded method codes only. No provider references or secrets.                                                                                                                                                          |
| `POST /orders/{orderId}/payment`         | Extend existing route. Requires CSRF/origin, ownership and `Idempotency-Key`. Request: method, expected order version; existing dev/test `simulateOutcome` remains backward compatible but is rejected outside internal test/demo mode. Response: bounded payment/attempt state and next-action kind. |
| `POST /orders/{orderId}/payment/confirm` | Retain existing route. Idempotently asks the adapter/worker to confirm or reconcile; it never marks success from the browser.                                                                                                                                                                         |
| `GET /orders/{orderId}/payment`          | Owner-only recovery projection: amount/currency, method, payment/attempt state, safe failure category and timestamps. No raw provider reference.                                                                                                                                                      |
| `POST /orders/{orderId}/payment/cancel`  | Idempotently cancels only an unsubmitted/authoritatively cancellable attempt. Unknown or possibly charged attempts cannot be cancelled locally.                                                                                                                                                       |
| `GET /orders/{orderId}` and timeline     | Extend existing safe projection with localized payment presentation codes and timestamps.                                                                                                                                                                                                             |

Successful start remains `201` for Stage 5 compatibility and means “durable
attempt accepted”, not “money received”. Replays return the original status and
body. Changed payload under the same key returns `409`.

### Provider route

`POST /payments/webhook` remains the sole production webhook boundary. It is
public only through the existing `PublicWebhook` guard, uses exact raw bytes,
adapter authentication, replay protection and bounded acknowledgements.
`/payments/mock/callback` remains dev/test-only for Stage 5 regression and is
forbidden in production.

### Minimal finance operations

| Route                                                | Contract                                                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/finance/payments`                        | `FINANCE_ADMIN` only; bounded filters/status, attempt state, timestamps, safe failure/reconciliation code and provider-reference fingerprint. |
| `GET /admin/finance/payments/{paymentId}`            | Safe lineage to order/snapshot/attempt/events; no address, customer PII, raw provider payload/token/reference or payment details.             |
| `POST /admin/finance/payments/{paymentId}/reconcile` | `FINANCE_ADMIN`, CSRF/origin and `Idempotency-Key`; queues the existing provider-neutral reconciliation operation.                            |

Existing `/admin/finance/reconciliation` remains valid. No general-purpose
manual status override is added.

### Error semantics

Bounded codes include `ORDER_NOT_PAYABLE`, `PAYMENT_ATTEMPT_ACTIVE`,
`PAYMENT_METHOD_UNAVAILABLE`, `PAYMENT_STATE_UNKNOWN`, `PAYMENT_FAILED`,
`PAYMENT_CANCEL_NOT_ALLOWED`, `CHECKOUT_LINEAGE_STALE`,
`PROVIDER_TEMPORARILY_UNAVAILABLE`, `RECONCILIATION_REQUIRED` and existing
idempotency/version conflicts. Stack traces and provider messages are never
returned.

## 9. Customer Web/PWA flow

Mobile-first RU/UZ screens extend the existing order route:

1. checkout summary shows immutable service/configuration, selected studio
   preference/fallback, pickup or delivery label, itemized delivery fee and
   final UZS total;
2. customer selects one server-advertised payment method;
3. confirm/pay submits one idempotent request and immediately renders the
   server response;
4. `PENDING|PROCESSING|UNKNOWN` shows a non-success processing/recovery state
   and polls/reloads the owner payment projection with bounded backoff;
5. `SUCCEEDED` is shown only after server state is `PAID`;
6. `FAILED|CANCELLED` shows localized safe guidance and allows a new attempt
   when the server says it is safe;
7. refresh, sign-out/sign-in and temporary network loss resume from the order,
   payment and timeline APIs without local secret or authoritative state.

The service worker remains network-only for API, auth, orders, payment and
provider continuation URLs. Payment state, provider tokens and continuation
URLs are never stored in Cache Storage, IndexedDB or localStorage.

## 10. Admin and operations scope

The existing finance screen gains only an operational payment list/detail,
reconciliation action and bounded incident state. It does not expose customer
address, phone, file data, payout internals to customers, or unrestricted raw
provider metadata. There is no large finance dashboard, manual success button
or direct database repair workflow.

Operators can determine whether an attempt is created, processing, unknown,
failed or succeeded; see safe timestamps/fingerprints; and enqueue
reconciliation. Corrections remain provider events, reconciliation outcomes or
existing refund workflows.

## 11. Provider-neutral adapter architecture

Extend the existing `PaymentProvider` port rather than creating a new module:

- `capabilities()` returns bounded available method kinds;
- `createAttempt()` accepts merchant attempt reference, immutable amount/
  currency and `ProviderContext`, returning a protected provider reference and
  bounded next-action type;
- `confirm()` and `status()` remain authoritative provider-neutral operations;
- `cancel()` is optional/capability-gated and must report authoritative result;
- `parseWebhook(rawBytes, headers)` authenticates exact bytes and maps only to
  normalized bounded events;
- `refund()` remains the Stage 5/8 contract.

The adapter never receives document content, address, phone, object keys,
studio contact data or payout data.

### Deterministic internal adapter

An explicit internal adapter supports `SUCCESS`, `FAILURE`, `RETRY`, duplicate
event, delayed event and `TIMEOUT/UNKNOWN`. Scenarios are selected by bounded
test/demo configuration, not by a production customer-controlled secret.
State is deterministic by merchant attempt reference, so worker redelivery and
reconciliation return the same outcome.

`PAYMENT_PROVIDER=internal|mock` is rejected when `NODE_ENV=production`.
Production requires the existing HTTPS adapter endpoint, API key and webhook
secret validation. Missing or invalid configuration fails startup; it never
falls back to internal behavior.

## 12. Webhook and event architecture

1. Nest retains exact raw request bytes before JSON parsing.
2. The configured adapter authenticates signature/timestamp/key rotation and
   returns a normalized event or invalid result.
3. Invalid authentication returns `403` without storing attacker payload.
4. Payload hash plus `(provider,eventId)` identifies exact duplicates and
   changed replays.
5. The transaction locks payment/attempt/order, checks merchant/provider
   reference, amount/currency and legal transition, performs CAS updates,
   writes the immutable callback disposition and one outbox event.
6. Same event/same hash returns its stored response; same event/different hash
   returns `409` and a bounded security audit event.
7. Unknown authenticated event types are recorded only as bounded metadata and
   acknowledged safely. They never mutate payment/order state.
8. Out-of-order or contradictory events create reconciliation-required state;
   they do not silently overwrite history.

Logs and audit contain only bounded provider code, operation, outcome,
disposition and safe error category. Event IDs, hashes and request IDs are not
metric labels.

## 13. Reconciliation design

- A transactional outbox event schedules reconciliation when an attempt stays
  `PROCESSING` past its deadline, becomes `UNKNOWN`, receives contradictory
  events or the client requests confirmation.
- BullMQ is delivery only. `FinancialJob`, inbox deduplication, lease, attempts
  and stable dedup keys are PostgreSQL-authoritative.
- The worker calls `PaymentProvider.status()` with an attempt-derived provider
  idempotency key and compares reference, status, amount and currency.
- A matching terminal result is applied through the same domain transition as
  a webhook and records `FinancialReconciliation(MATCHED)`.
- A mismatch records `MISMATCH`, leaves the order out of production and
  requires finance review. Nothing is silently edited.
- Temporary errors use bounded exponential retry; after the configured limit
  the financial job enters dead-letter/manual review.
- Re-running the same reconciliation reference is idempotent through existing
  `(kind,entityId,runKeyDigest)` uniqueness.

The internal adapter implements status deterministically, so every ambiguous
scenario is testable without external services.

## 14. Idempotency and concurrency model

- Every customer/admin mutation requires `Idempotency-Key`; request hash and
  prior response use the existing `IdempotencyRecord` contract.
- Payment attempt creation locks `Order` then `Payment`, checks aggregate
  versions and relies on the unresolved-attempt partial unique index.
- Durable attempt/outbox commit precedes provider I/O. Provider calls use the
  attempt merchant reference as their stable idempotency key.
- Callback and reconciliation share one transition function and lock order,
  payment and attempt in a documented order.
- PostgreSQL `P2034` and raw `40001` conflicts use bounded replay recovery;
  they never become duplicate attempts.
- Two Pay clicks with the same key replay one response. Different keys racing
  create at most one active attempt; the loser receives a bounded conflict.
- Same key with different method/payload returns `409`.
- Exactly one `PAYMENT_SUCCEEDED` outbox event/version is emitted. Existing
  matching inbox, unique assignment, production-cycle, fulfillment, PIN,
  fiscal and ledger constraints prevent duplicate downstream effects.
- An `UNKNOWN` attempt blocks another attempt until reconciliation, avoiding
  possible double charge.

## 15. Security and privacy model

- No PAN, CVV, bank credential, stored card, provider secret or unrestricted
  token is accepted or stored.
- Future card entry must occur on a contracted provider-hosted page/SDK; core
  APIs receive only protected provider references.
- Provider references are encrypted or separately protected at rest where
  needed for API calls; customer views never contain them. Operations use a
  non-secret fingerprint.
- Existing access cookies, CSRF/origin guard, ownership-hiding `404`, RBAC,
  rate limiting and `no-store, private` apply.
- Customer can access only own order/payment projections. `FINANCE_ADMIN` is
  required for reconciliation/operational views. Partner/courier roles receive
  no payment amount beyond existing order projections and never receive
  provider metadata.
- Audit payloads contain bounded action/status/method kind only. Logs,
  notifications and metrics exclude phone/address, card data, provider
  references/tokens, event IDs, full URLs/query strings, order/payment/attempt
  IDs and user-controlled text.
- Metric labels remain route template, method, response code, role, bounded
  operation and domain status.
- Payment and continuation routes are service-worker network-only and never
  enter browser persistence/analytics.

## 16. Legacy compatibility

- Existing Stage 1–13 orders and drafts remain readable and operational.
- Existing `AWAITING_PAYMENT` orders use their frozen `PriceSnapshot`; Stage 13
  orders additionally require their immutable fulfillment snapshot. Legacy
  orders without Stage 13 lineage follow the already-supported legacy
  fulfillment path and are not rewritten.
- Existing succeeded/refunded payments retain status and finance lineage.
- Existing Stage 5 mock callback and confirmation tests remain supported in
  development/test.
- Existing production HTTP/raw-body webhook behavior remains fail-closed.
- Existing order status names and downstream `PAID` behavior do not change.
- API additions are additive; existing fields retain their wire types.

## 17. Migration, deployment and backfill strategy

1. Add enum values, `PaymentAttempt`, nullable callback linkage and indexes in
   one forward migration.
2. Backfill deterministic legacy attempts without provider I/O; assert money,
   order and reference uniqueness.
3. Deploy code that reads both legacy and Stage 14 rows before enabling the
   purchase UI/dispatcher.
4. Enable the internal adapter only in explicit development/test/demo
   environments. Production configuration remains unchanged until a real
   provider contract exists.
5. Enable durable payment dispatch/reconciliation workers after schema and
   health validation.
6. Enable RU/UZ UI last and monitor bounded attempt outcomes/dead letters.

Repeated `prisma migrate deploy` must report no changes. There is no automatic
destructive down migration after financial rows exist.

## 18. Testing matrix

### Unit

- payment/attempt transition table and terminal monotonicity;
- integer UZS/money and snapshot-digest validation;
- internal deterministic scenario mapping;
- raw-body signature, timestamp and replay parsing;
- localized safe status/error mapping;
- production environment rejection of internal/mock or missing real secrets;
- metric-label and audit-redaction allowlists.

### Integration

- immutable source triggers and money constraints;
- one unresolved attempt partial uniqueness;
- attempt/outbox atomicity and inbox redelivery;
- callback/reconciliation shared transition;
- legacy backfill and provider-reference lookup;
- no-store, ownership and `FINANCE_ADMIN` RBAC.

### DB-E2E

- double Pay click, same-key replay and conflicting-key payload;
- concurrent different-key attempt creation;
- success, failure, cancel, retry and timeout/unknown;
- duplicate event, changed replay, invalid signature and unknown event;
- out-of-order failure/success and callback before browser response;
- success followed by client disconnect/refresh;
- worker restart after durable attempt but before/after provider call;
- concurrent callback/reconciliation and serialization retry;
- stale quote, stale fulfillment/studio lineage and immutable snapshot checks;
- studio unavailable, strict failure and allowed fallback after payment;
- single `PAID`, matching, production, fulfillment, PIN, fiscal and ledger side
  effects under repeated delivery;
- legacy orders with/without payment metadata;
- admin reconciliation mismatch, retry and dead-letter behavior;
- absence of secrets, raw references, addresses and PII in logs/audit/metrics.

### Playwright

- RU pickup: checkout summary → internal method → pay → processing → success →
  order timeline;
- UZ delivery: itemized zonal fee → pay → disconnect/reload → authoritative
  success recovery;
- failure then safe retry;
- pending/unknown then reconciliation and refresh;
- double-click protection and offline/network retry;
- no technical IDs, provider data, internal status names or English leakage in
  the primary RU/UZ flow.

Retries must not hide flaky behavior; both mandatory flows pass on their first
attempt in the final run.

## 19. Stage 1–13 regression plan

The infrastructure job remains strictly sequential:

1. current `quality` job and foundation DB tests;
2. `stage2.sh` through `stage13.sh` unchanged in assertions;
3. only after all prior gates pass, `stage14.sh`.

Stage 14 cannot replace Stage 5 payment/refund, Stage 8 aftercare, Stage 9
finance, Stage 11 checkout, Stage 12 preference or Stage 13 fulfillment tests.
Any exposed failure is diagnosed and fixed at its root rather than skipped,
retried as success or made optional.

## 20. Infrastructure, backup and verification plan

`ops/verify/stage14.sh` will:

- build/health-check PostgreSQL, Redis/BullMQ, MinIO, ClamAV, API, PWA,
  processing, backup and restore images;
- deploy migrations to a clean database and deploy again with no changes;
- run Stage 14 DB-E2E and first-attempt RU/UZ Playwright;
- exercise worker loss/redelivery and reconciliation after restart;
- check production fail-closed configuration and internal adapter isolation;
- verify no-store, service-worker policy, logs, audit and metrics privacy;
- create synthetic payment/attempt/event/financial lineage;
- run encrypted off-host restic backup, destroy sources, restore PostgreSQL/
  MinIO in isolation, replay tombstones, validate immutable lineage and measure
  RPO/RTO;
- write `stage14-verification-report.json` plus SHA-256 sidecar on success or
  failure. Actions uploads it with `if: always()` while preserving job failure.

Payment, attempt, callback and reconciliation records are included in backup
and are not automatically deleted until legal retention is approved.

## 21. Acceptance criteria

Stage 14 is complete only when one final `main` SHA proves all of the following:

1. customer completes RU pickup and UZ delivery purchase journeys without any
   external provider or fake pre-confirmation success;
2. total, delivery fee, configuration, layout, studio preference and
   fulfillment selection remain identical to immutable checkout snapshots;
3. one successful attempt produces exactly one `PAID` transition and one set
   of downstream side effects;
4. failure, cancellation, retry, duplicate, disconnect and unknown-result
   recovery are authoritative and resumable;
5. duplicate/out-of-order/invalid webhook and reconciliation cases satisfy the
   state machine and replay rules;
6. concurrent clicks/checkouts/attempts/callbacks cannot double-charge or
   duplicate order, production, fulfillment, PIN, fiscal or ledger records;
7. production rejects internal/mock adapters and missing real credentials;
8. owner isolation, finance RBAC, CSRF/origin, no-store, service-worker,
   redaction and low-cardinality metric gates pass;
9. legacy Stage 1–13 data and APIs remain compatible;
10. Prisma generate/validate, clean/repeated migrations, format, lint,
    typecheck, unit/integration, production build, Stage 14 DB-E2E and browser
    E2E pass;
11. complete Stage 1–13 sequential regression passes first;
12. Docker infrastructure, encrypted backup, isolated restore, tombstones,
    integrity and RPO/RTO pass;
13. `quality=success`, `infrastructure=success`, final verification artifact is
    validated, working tree is clean and `main == origin/main` with `0/0`
    divergence.

## 22. Explicit out of scope

- Click, Payme, Uzum or any other real acquiring integration;
- raw card PAN/CVV collection, stored cards, token vault or PCI card form;
- real fiscal, SMS/OTP, maps/geocoding or courier provider;
- cash on delivery, split/tendered payments, installments or multi-currency;
- multi-partner cart, subscriptions, loyalty/bonuses;
- inventory/stationery commerce, marketplace expansion, route/GPS/ETA;
- reviews, chat, support evidence uploads or large finance dashboard;
- redesign of refunds, fiscalization, payout settlement, matching, delivery or
  fulfillment already accepted in Stage 1–13;
- Stage 15 design or implementation.

## 23. Risks and mitigations

| Risk                                   | Mitigation                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Duplicate charge after timeout         | One unresolved attempt, stable provider idempotency key, `UNKNOWN` blocks retry, reconciliation before another attempt.              |
| Callback before local response         | Durable attempt/outbox exists before provider I/O; callback resolves merchant attempt reference.                                     |
| Provider says success after failure    | Do not auto-produce; mark reconciliation required and preserve both immutable events.                                                |
| UI shows false success                 | UI derives success only from owned server projection with `Order=PAID`.                                                              |
| Existing Stage 5/9 duplication         | Extend `Payment`, `ProviderCallback`, provider port and `FinancialReconciliation`; no parallel aggregate.                            |
| Capacity changes during payment        | Recheck before submit; post-payment existing matching/fallback/refund remains authoritative. Do not reserve capacity across payment. |
| Provider reference leakage             | Protected storage, customer omission, admin fingerprint, redaction tests.                                                            |
| Backfill ambiguity                     | Link only uniquely resolvable references; nullable legacy linkage plus explicit integrity report.                                    |
| Internal adapter enabled in production | Startup validation rejects it and never falls back from the configured adapter.                                                      |
| Legal retention unknown                | Financial records remain retained and included in encrypted backup; no automatic deletion.                                           |

## 24. External blockers

No external dependency blocks Stage 14 implementation, automated acceptance or
MVP demonstration. The deterministic internal adapter covers the complete
accepted flow outside production.

Production collection of real money remains externally blocked by merchant
contracts, provider API/webhook credentials, sandbox certification, fiscal
requirements and legal approval. Those items must be classified as
“implemented boundary, externally unverified” rather than simulated with fake
production credentials. Existing production startup remains fail-closed.

## 25. Proposed implementation sequence

1. Freeze this proposal and update PRD/architecture/security/testing only after
   implementation approval.
2. Add forward Prisma migration, constraints, legacy backfill and schema tests.
3. Extend provider contracts and deterministic internal adapter while retaining
   Stage 5/9 compatibility.
4. Refactor payment start to durable attempt/outbox before provider I/O.
5. Implement shared callback/reconciliation transition and financial worker.
6. Add customer recovery/payment APIs and minimal finance-admin APIs.
7. Implement RU/UZ mobile-first payment UI and timeline/notification codes.
8. Update OpenAPI, ERD, ADR, threat model, operations and backup documents.
9. Add unit/integration/DB-E2E/security/concurrency tests.
10. Add first-attempt RU/UZ Playwright and `stage14.sh`/CI artifact.
11. Run clean/repeated migrations, local available gates, full Stage 1–13
    regression, Stage 14 infrastructure/backup/restore and final CI.

## 26. Rollback strategy

- Before enabling Stage 14, deployment can roll back application code while
  leaving additive tables/nullable columns unused.
- A feature flag disables new attempt creation/UI and workers; existing
  attempts remain readable and reconciled by the compatible code path.
- After any Stage 14 attempt exists, schema rollback is forward-fix only. Never
  drop payment attempts/events or reverse enum values containing financial
  history.
- If callback/worker deployment is unhealthy, stop new attempts, keep webhook
  authentication available, retain events/jobs and reconcile after the fix.
- Existing Stage 5 payment/refund and legacy order projections remain available
  throughout rollout; no direct SQL status repair is permitted.
- Restore follows the existing isolated PostgreSQL/MinIO procedure, applies the
  current retention ledger/tombstones, validates payment lineage, and enables
  API/workers only after integrity checks succeed.

---

This document is a proposal and acceptance contract only. **Stage 14
implementation has NOT started.**
