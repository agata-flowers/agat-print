# AGAT PRINT MVP PRD

## Product value

AGAT PRINT lets a customer prepare a print job remotely, know the price before payment, and route it to a capable nearby studio. The pilot serves Tashkent in Russian and Uzbek and is optimized for weak mobile connections.

## Stage 1–7 release

This release establishes secure identity, partner onboarding and protected file
intake. An authenticated user can reserve quota, upload PDF, DOCX, JPG/JPEG or
PNG into private quarantine, receive bounded validation/antivirus rejection,
cancel an upload, and have an accepted file queued for isolated normalization.
Stage 4 adds preflight, immutable preview/print-ready versions, bounded manual
review and latest-version customer approval. Stage 5 adds versioned UZS
tariffs, order creation from that active approval, an immutable price snapshot,
mock payment and an idempotent full-refund foundation.
Stage 6 adds deterministic partner offers, immutable payout snapshots and
manual production. Stage 7 adds a branch-local printer-agent option, protected
pickup, basic courier assignment/delivery and terminal `COMPLETED`.

## MVP boundary

The full MVP will later accept only PDF, DOCX, JPG/JPEG, and PNG; produce immutable originals, derived previews, print-ready files, pricing snapshots, mock payments, partner assignment, manual partner printing, pickup/basic delivery, notifications, audit, and retention.

Excluded until separate approval: marketplace, essays/presentations, restoration, design/3D editors, subscriptions, corporate billing, printer integration, and custom courier optimization.

## Roles and stories

| Role               | Current story                        | Acceptance criterion                                                  |
| ------------------ | ------------------------------------ | --------------------------------------------------------------------- |
| Customer           | Sign in by phone without a password  | OTP expires, is single-use, attempt-limited, and creates safe cookies |
| Partner applicant  | Register a company and branch        | Record is pending and protected from partner-only access              |
| Administrator      | Review and approve a partner         | Approval is audited and grants the partner role atomically            |
| Courier            | Deliver an assigned ready order      | Own active delivery, two-party handoff and customer PIN complete      |
| Partner            | Hand off a ready order               | Own assignment only; customer/courier PIN is attempt-limited          |
| Authenticated user | Upload one supported private file    | Quota, signature, AV and isolation controls pass before persistence   |
| Customer           | Review and confirm the latest layout | Own private preview only; stale or concurrent approval is rejected    |
| Administrator      | Decide an uncertain photo review     | ADMIN-only decision is CAS-protected and safely audited               |
| Customer           | Pay the frozen total                 | Only a current approved print-ready layout can become an order        |
| Administrator      | Publish a tariff version             | Integer UZS values, ADMIN RBAC, immutable existing snapshots          |

## Non-functional requirements

- Mobile-first, RU/UZ, EN-ready, accessible controls.
- No sensitive caching, private data in telemetry, or production mock OTP.
- API contracts remain usable by future native applications.
- RPO ≤ 24 hours and RTO ≤ 4 hours with encrypted off-host backups.
- Critical state changes are transactional, idempotent, and auditable.

## Backlog sequence

1. Secure file intake and isolated conversion foundation — implemented.
2. Preflight, quality/manual review, preview, and approval — implemented.
3. Pricing, order state machine, and mock payment/refund — implemented.
4. Partner matching, offered payout snapshot, manual production — implemented.
5. Printer-agent, pickup, courier assignment and basic delivery — implemented.
6. Disputes, reprints and expanded retention automation — future approval.

## Legal decisions required before pilot

- Lawful basis, consent wording, data residency, processors, and cross-border transfer.
- Required retention for orders, payments, fiscal records, disputes, and audit.
- Official-photo disclaimers and accepted document templates.
- Payment tokenization, fiscal receipts, refunds, reconciliation, and partner payouts.
- Partner/courier contracts and responsibility for confidential print materials.

## Stage 8 approved boundary

Aftercare covers a 72-hour dispute window after COMPLETED or DELIVERY_FAILED,
one active dispute and one immutable decision. Decisions are exclusively
NO_ACTION, REPRINT, PARTIAL_REFUND or FULL_REFUND. No evidence-file uploads;
only bounded categories and optional restricted text. Reprint reuses the
approved artifact and original partner with a new production/fulfillment
cycle. It never combines with a refund in one decision.

Automate only already-defined object retention; financial/legal records wait
for separately approved legal periods. Marketplace expansion, rematching and
GPS/route optimization remain outside this approval. Production provider and
financial-ledger work is introduced only by the separately approved Stage 9.

## Stage 9 approved boundary — Production Pilot Readiness

Stage 9 introduces fail-closed production OTP, payment and fiscal provider
boundaries while retaining mock adapters exclusively for development and tests.
Provider credentials and merchant contracts are deployment prerequisites and
are never represented by repository defaults. Payment webhooks are signed,
replay-safe, idempotent and tolerant of duplicate or out-of-order delivery.

Fiscal operations are immutable records linked to payments, orders and refunds,
with durable retry and reconciliation states. Partner earnings are recorded in
an append-only UZS ledger derived from the accepted payout snapshot. Settlement
batches net one partner's eligible credit/debit entries exactly once and retain explicit reconciliation
mismatches instead of silently modifying financial history. Refunds and disputes
produce traceable ledger adjustments; cumulative money remains integer minor
units and cannot exceed the underlying payment or earning.

Acceptance requires production configuration to fail closed without real
provider endpoints and secrets; explicit finance-admin RBAC; transactional
outbox/inbox and idempotency for mutations and jobs; concurrency tests for
payment, refund and payout reservation; signed webhook replay tests; fiscal and
payout reconciliation mismatch/retry tests; clean migrations; the complete
Stage 1–8 regression suite; Docker infrastructure verification; and a published
Stage 9 verification artifact.

Marketplace expansion, new matching, advanced routing, document editing and
unrelated customer functionality are outside Stage 9.

## Stage 10 approved boundary — Partner Marketplace & Production Network

Stage 10 extends the existing partner, branch and Stage 6 matching aggregates
with moderated lifecycle, owned studio profiles, immutable operational,
capability, catalog and capacity versions, temporary availability and
service-area eligibility. Matching persists bounded explainable candidate
evaluations and ranks eligible branches deterministically by configured
priority, distance, workload and stable identity.

Offer capacity is reserved transactionally and released idempotently on
expiry/rejection or consumed on acceptance. Acceptance revalidates the current
versions and availability so stale offers cannot create an assignment.
Suspension prevents new work while allowing an already accepted paid order to
finish. Existing one-partner assignment, payout snapshots, production,
fulfillment, aftercare and finance invariants remain unchanged.

The complete contract, tests and explicit exclusions are defined in
[`STAGE10.md`](STAGE10.md). Customer marketplace UI, route optimization,
subscriptions, new payment integrations and Stage 11 are not included.

## Stage 11 approved boundary — Customer Ordering & Service Catalog MVP

Stage 11 connects the existing technical pipeline into a resumable mobile-first
RU/UZ customer journey. It adds an immutable platform service catalog, owned
order drafts, server-authoritative expiring quotes, guided upload/layout/
approval/checkout screens, order history and bounded timeline, and durable
in-app notifications. The implementation reuses every Stage 1–10 aggregate and
keeps one print-ready artifact and one partner per order.

Acceptance requires PDF, DOCX, JPG/JPEG and PNG DB-E2E, at least one browser
E2E through the real UI and internal APIs, stale-lineage and concurrent checkout
tests, owner isolation, localized safe errors, complete Stage 1–10 regression,
clean/repeated migrations, infrastructure recovery and a successful Stage 11
verification artifact. The full contract is defined in
[`STAGE11.md`](STAGE11.md).

Inventory-backed stationery, multi-line/multi-partner carts, customer partner
selection, advanced routing, editors, subscriptions and Stage 12 are outside
this approval.

## Stage 12 approved boundary — Customer Studio Marketplace

Stage 12 exposes the moderated Stage 10 production network to
customers and adds an optional, explicit studio preference to the existing
Stage 11 draft and Stage 6/10 matcher. It preserves automatic assignment, one
partner per order, authoritative eligibility/capacity checks and the existing
offer, refund, fulfilment and finance state machines. Inventory-backed
stationery and multi-partner carts remain outside the proposal.

The complete scope and acceptance criteria are defined in
[`STAGE12_PROPOSAL.md`](STAGE12_PROPOSAL.md). Later product stages remain
outside this approval.
