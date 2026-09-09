# Stage 12 proposal — Customer Studio Marketplace & Controlled Partner Preference

Status: proposed; implementation requires separate approval.

Baseline: Stage 11 commit `1adee274d1913995cd6ad55c6211df94a3d751a1`
and Actions run `34355205979`. Stages 1–11 remain authoritative.

## Gap analysis and choice

AGAT PRINT can already take a customer from a platform service catalog through
file processing, approval, authoritative pricing and checkout, then match one
eligible partner and complete production/fulfilment. Stage 10 also contains the
moderated studio network, versioned capability/catalog/availability/capacity
records and explainable matching, but none of that network has a safe customer
projection. Customers cannot discover an active studio, understand its public
services or express a partner preference before checkout.

The remaining work falls into four groups:

- **MVP/product-network gap:** customer-visible studio discovery and a safe,
  optional preference that is consumed by the existing matcher.
- **Production-launch work:** provider certification, legal retention decisions,
  operational content moderation and production-scale recovery exercises.
- **Post-MVP product work:** inventory-backed stationery, multi-line carts,
  multi-partner splitting, reviews, loyalty, subscriptions, editors and advanced
  routing.
- **Externally dependent work:** real SMS/OTP, acquiring, fiscal, payout,
  delivery, outbound notification and maps/geocoding integrations.

Stage 12 therefore exposes the already-built production network to customers.
It does not introduce retail inventory or a second matcher. This is the smallest
coherent step that turns automatic fulfilment into an understandable partner
marketplace while retaining one order, one print-ready artifact and one active
partner assignment.

## 1. Goal and user value

A customer can browse moderated studios capable of the selected service, see
bounded public availability and fulfilment information, and either keep
automatic assignment or express a preferred studio. The choice is visible and
understandable in RU/UZ, but final eligibility, capacity reservation and offer
acceptance remain server-authoritative.

## 2. Exact scope

1. Add an immutable, moderated, versioned public studio listing projection over
   the existing `Partner`, `Branch` and Stage 10 version records.
2. List only ACTIVE partners and active branches with a currently PUBLISHED
   listing and current compatible service/capability configuration.
3. Support filtering by platform service, bounded service options, fulfilment
   mode, city/location code and an optional transient origin for proximity.
4. Return public name, localized description, district/city, bounded opening
   state, supported service summaries and approximate distance band. Never
   expose capacity counters, exact workload, operational contacts, coordinates
   or internal identifiers.
5. Add `AUTO_ASSIGN` and `PREFERRED_STUDIO` draft choices. A preferred choice
   has an explicit bounded fallback policy: `ALLOW_ELIGIBLE_ALTERNATIVE` or
   `STRICT_PREFERENCE`.
6. Store an immutable checkout selection snapshot with the listing and relevant
   Stage 10 version lineage. It does not reserve capacity and does not replace
   `PartnerPayoutSnapshot` or `PartnerAssignment`.
7. Extend the existing Stage 6/10 matcher only: an eligible preferred branch is
   deterministically ranked first with bounded reason `CUSTOMER_PREFERRED`.
   Alternatives retain the existing deterministic ordering.
8. Revalidate lifecycle, listing, capability, catalog, hours, service area and
   capacity both when creating an offer and accepting it. Preference never
   bypasses eligibility or the existing reservation/assignment constraints.
9. For strict preference that becomes unavailable after payment, create no
   incompatible offer and use the existing single no-executor/refund path. For
   allowed fallback, continue with the next eligible existing candidate.
10. Add owner-only partner listing draft/preview submission and ADMIN-only
    publish, reject, suspend-from-marketplace and retire operations with safe
    audit.
11. Add customer studio discovery, studio detail, automatic/preferred choice
    and preference summary to the current Stage 11 flow.
12. Add bounded customer timeline/notification presentations for preference
    fallback or strict-preference unavailability without leaking matching
    internals.

## 3. Explicitly out of scope

- Inventory-backed stationery/SKUs, stock reservation, retail returns, carts,
  bundles or warehouse accounting.
- Multi-line, multi-studio or multi-partner orders and automatic order splitting.
- A second matching pipeline, customer-side assignment, bypassing offers, or
  reserving production capacity before payment.
- Reviews, ratings, partner messaging, public operational contacts, promotions,
  loyalty, subscriptions or advertising.
- Customer-visible exact capacity/workload, precise coordinates, live GPS,
  traffic ETA, route optimization or courier marketplace.
- New payment/OTP/fiscal/payout providers, document/photo editors, new file
  formats or changes to immutable financial snapshots.
- Real maps/geocoding or other externally credentialed integrations.
- Any stage following Stage 12.

## 4. User flows

### Customer

1. Home or service page opens “Studios” with RU/UZ copy.
2. Customer selects a service/options and sees only compatible published
   studios, or chooses automatic assignment.
3. Studio detail shows bounded public information, supported service summary,
   opening state and approximate proximity—not internal capacity.
4. Customer selects preferred studio and fallback policy without entering IDs.
5. The preference is attached to the resumable owned draft and survives refresh,
   re-login and retry.
6. Upload, processing, approval, quote and checkout continue through the Stage
   3–11 contracts. Checkout revalidates the preference lineage.
7. After payment, the existing matcher evaluates and offers atomically. The
   customer sees only localized status/fallback information.
8. Existing payment, production, pickup/delivery, completion and aftercare flows
   remain unchanged.

### Partner and platform operator

1. Partner owner prepares and previews only its own studio listing.
2. ADMIN moderates bounded content and publishes/rejects/retires a version.
3. Lifecycle suspension immediately removes the studio from discovery and
   prevents new offers/accepts, while an accepted job may safely finish under
   the Stage 10 invariant.
4. Operators inspect bounded audit and reason codes without customer search
   coordinates, IDs, contact data or free text.

## 5. Backend and API changes

REST remains under `/api/v1` and follows current envelopes/cache policy.
Proposed additions:

- `GET /studios` — public compatible marketplace projection with bounded
  filters and cursor pagination.
- `GET /studios/{publicSlug}` — one currently published public listing.
- `PUT /order-drafts/{draftId}/studio-preference` — owner-only, CAS and
  `Idempotency-Key` protected selection/invalidation.
- `DELETE /order-drafts/{draftId}/studio-preference` — idempotently return to
  automatic assignment.
- `GET /partner/network/listing` and
  `PUT /partner/network/listing/draft` — own listing preview/draft.
- `POST /partner/network/listing/submit` — own submission.
- `GET /admin/partner-listings` and bounded detail — moderation queue.
- `POST /admin/partner-listings/{listingId}/decision` — ADMIN-only publish,
  reject or retire with CAS and idempotency.

Existing checkout, matching, offer, accept, refund and timeline endpoints are
extended, not duplicated. Public URLs use stable moderated slugs; customers do
not type or see UUIDs. OpenAPI must describe fallback semantics and the fact
that displayed availability is indicative while matching is authoritative.

## 6. Database and migrations

Proposed additive Prisma changes:

- `StudioListingVersion`: branch, sequence, bounded localized copy, public slug,
  moderation state, author/moderator, publication timestamps and immutable
  history.
- `OrderDraftStudioPreference`: owned draft, mode, public listing lineage,
  fallback policy, aggregate version and expiry/invalidation metadata.
- `OrderStudioSelectionSnapshot`: immutable checkout snapshot linked one-to-one
  with an order and containing only bounded mode/fallback plus listing,
  capability, branch-catalog and operational version lineage.
- A bounded `CUSTOMER_PREFERRED` matching reason and optional safe preference
  outcome on the existing candidate evaluation.
- Required unique constraints for one current listing per branch, one preference
  per draft and one selection snapshot per order; indexes for published service
  discovery and moderation queues.
- Database triggers preventing edits/deletes of published listing versions and
  selection snapshots.

No existing order, price, payout, payment, fiscal, fulfilment or dispute row is
rewritten. Existing orders remain valid with nullable Stage 12 lineage.

## 7. Web/PWA UI

- `/studios`: responsive RU/UZ discovery with service and fulfilment filters.
- `/studios/[slug]`: moderated public studio detail.
- Stage 11 catalog/new-order/draft screens: automatic versus preferred studio,
  bounded fallback explanation and resumable summary.
- Partner network screen: own draft/preview/submission only.
- Admin moderation screen: bounded listing comparison and decision.
- Customer order/timeline: localized fallback/unavailability presentation,
  never matcher reason dumps or internal state names.
- EN remains fallback-ready through the existing locale structure.

No precise location, signed URL, auth state, draft/order identifier or sensitive
contact is stored in localStorage, IndexedDB, analytics or Cache Storage.

## 8. Admin/operator/studio flow

- PARTNER edits only an unpublished version for its own branch and cannot
  publish it.
- ADMIN publishes only after the partner/branch lifecycle and current network
  configuration pass validation.
- Suspension/closure removes discovery immediately through authoritative joins,
  even if a published listing record remains for audit.
- Listing changes append versions. Critical submit/publish/reject/retire events
  are safely audited using bounded action/status fields only.

## 9. Security and privacy requirements

- Public projection is an explicit allow-list. Exclude owner/customer IDs,
  operational contacts, encrypted fields, exact coordinates, workload,
  provider references and internal version IDs.
- Optional search origin is validated, used in memory for provider-neutral
  distance calculation and never persisted, audited, logged or labelled.
- Draft preference is owner-only; foreign drafts/listings remain indistinguishable
  from missing resources where applicable.
- Listing mutations require CSRF, Origin validation, secure cookies, RBAC and
  `Idempotency-Key`; publication is ADMIN-only.
- `/api/**`, drafts, studio preference and personalized discovery are
  `Cache-Control: no-store, private` and service-worker network-only. A public
  non-personalized listing response may be short-cacheable only after a separate
  security review; the default for Stage 12 is no-store.
- Free-form public content is length/character bounded, moderated and absent
  from logs, audit payloads and metric labels.
- Existing secrets, PIN, address, file, signed-URL and finance redaction rules
  remain unchanged.

## 10. Reliability, idempotency and concurrency

- Listing publication, preference mutation, checkout and matching changes use
  PostgreSQL transactions, aggregate CAS and transactional outbox.
- Same idempotency key plus same canonical payload replays; changed payload
  conflicts. Owner identity participates in scope.
- Two concurrent listing publications leave one current published version.
- Two concurrent preference changes leave one version-consistent choice.
- Checkout locks/rechecks draft, quote, approval, catalog and preference lineage
  and creates at most one immutable selection snapshot.
- Matching reads the snapshot, then revalidates current Stage 10 eligibility.
  It never trusts discovery-time availability.
- Offer creation reserves capacity atomically; accept consumes the reservation
  and revalidates. Existing unique active assignment remains authoritative.
- Listing retirement, availability changes or suspension racing offer/accept
  can only yield a valid accepted assignment or a bounded stale/ineligible
  conflict—never an incompatible assignment.
- Outbox/inbox deduplication and bounded retries cover marketplace projection,
  preference notifications and fallback events.

## 11. Observability

- Bounded counters/timers: route template, method, status code, role, listing
  moderation result, preference mode, fallback outcome and matching reason enum.
- Never label by studio/partner/branch/draft/order/user ID, slug, district,
  coordinates, query, public text, IP, URL or request ID.
- Logs use request correlation only in logs and bounded error codes. Audit uses
  bounded action/status metadata without public copy or search parameters.
- Alerts cover publication conflicts, projection lag, preference-stale rate,
  strict-preference refund rate, outbox dead letters and restore-integrity
  failures without high-cardinality dimensions.

## 12. Test strategy

- **Unit:** public allow-list mapping, RU/UZ fallback, option compatibility,
  distance bands, opening-state presentation, preference/fallback ranking,
  canonical idempotency payload and metric-label allow-list.
- **Integration/API:** listing lifecycle RBAC/audit, partner ownership isolation,
  public filtering, no-store responses, preference replay/conflict and safe
  localized errors.
- **Concurrency:** publish/publish, preference/preference, preference/checkout,
  suspend/match, availability/match, capacity last-slot and stale offer/accept.
- **Security/privacy:** foreign draft/listing access, injection/bounded text,
  transient location non-persistence and absence of IDs, exact coordinates,
  text, contacts and internal finance/storage values in API/log/audit/metrics.
- **Regression:** unchanged Stage 1–11 gates execute before Stage 12.

## 13. DB-E2E and Playwright E2E

Stage 12 DB-E2E must prove:

1. inactive, suspended, closed, unpublished and incompatible studios are absent;
2. service/options, opening hours, service area and indicative availability
   filtering agree with Stage 10 eligibility primitives;
3. preference deterministically ranks an eligible studio first;
4. fallback allowed selects the next eligible candidate; strict preference
   creates no invalid offer and reaches the existing single-refund path;
5. concurrent capacity/offer/accept and suspension races preserve one assignment;
6. stale listing/capability/catalog/preference lineage is rejected;
7. listing and selection snapshots are immutable;
8. RBAC, ownership, audit, privacy and outbox/inbox redelivery are enforced.

Playwright must cover at least one RU mobile journey:

`catalog → service/options → studio discovery → studio detail → preferred studio
→ upload/layout/approval → quote/checkout → preference visible in order status`.

A second focused UZ scenario verifies discovery, automatic assignment and safe
fallback copy. Browser assertions must prove that UUIDs, exact coordinates,
capacity, internal states and payout/provider data are not rendered.

## 14. Migration, deployment and rollback strategy

1. Ship additive enums/tables/nullable relations and immutable triggers.
2. Run Prisma validate/generate and clean plus repeated migration deployment.
3. Deploy API capable of reading orders without Stage 12 lineage.
4. Create listing drafts for eligible studios; ADMIN explicitly publishes them.
5. Enable customer discovery behind `CUSTOMER_STUDIO_MARKETPLACE_ENABLED`; keep
   preference writes disabled until listings and dashboards are healthy.
6. Enable preference ranking separately and monitor bounded outcomes.

Rollback disables the feature flags and returns all new drafts to the unchanged
`AUTO_ASSIGN` path. It does not drop tables or mutate historical snapshots.
Database rollback is forward-fix only after data exists. Backup/restore must be
validated before feature enablement.

## 15. Acceptance criteria

1. Customers browse only moderated, active and currently compatible studios in
   RU/UZ without seeing internal identifiers or operational/private data.
2. Automatic assignment remains backward-compatible for every pre-Stage-12
   draft/order and when the feature is disabled.
3. A resumable owned draft can carry one idempotent preferred-studio choice and
   explicit fallback policy; checkout freezes one immutable selection snapshot.
4. Preference only influences the existing deterministic matcher. It never
   bypasses eligibility, capacity reservation, offer TTL, accept revalidation or
   the unique active assignment constraint.
5. Strict and fallback behavior is deterministic, safely communicated and uses
   the existing single-refund invariant when no executor is available.
6. Concurrent publication, preference, checkout, suspension, capacity and accept
   races cannot expose an invalid studio or create double assignment/refund.
7. Partner and admin listing operations enforce ownership/RBAC and safe audit;
   public/customer responses contain no exact coordinates, workload, contacts,
   provider/storage/finance internals or free text outside moderated fields.
8. Stage 12 unit/integration/DB-E2E and RU/UZ Playwright scenarios pass, including
   security/privacy/idempotency/concurrency negatives.
9. Prisma generate/validate, clean and repeated migrations, frozen install,
   format/lint/typecheck/tests/build, Docker/Redis/BullMQ/MinIO/processing and
   full Stage 1–11 regression pass on final `main`.
10. Encrypted backup and isolated restore retain listing/preference/snapshot and
    matching lineage, replay tombstones/legal holds and pass integrity with
    measured RPO/RTO.
11. GitHub Actions `quality` and `infrastructure` are successful and an
    `stage12-verification-report` artifact records final SHA, regression,
    DB/browser E2E, security/concurrency and recovery results.

## 16. External blockers and dependencies

- Real maps/geocoding, route distance and ETA require a contracted provider,
  credentials, privacy assessment and production terms. CI uses the existing
  deterministic provider-neutral distance boundary.
- Real OTP/SMS, acquiring, fiscal, payout, delivery and outbound notification
  operations retain Stage 9 fail-closed configuration until contracts and
  secret-store credentials exist.
- Legal review must approve public partner content/contact policy, location
  precision, marketplace terms and customer wording for strict-preference
  refunds before production enablement.
- Partner operations must populate and moderate accurate listing/service/hour
  data; software cannot certify physical capability by itself.

## 17. Proposed deliverables

- This approved-scope document, PRD/architecture/ERD/state-machine/RBAC/threat
  model/operations/testing updates and OpenAPI changes.
- One additive Prisma migration and immutable constraints.
- Marketplace projection and preference extensions in the existing Partner,
  Ordering and Matching modules.
- Customer, partner and admin mobile-first UI routes/components.
- Outbox/inbox projection and notification work using existing workers.
- Unit/integration/DB-E2E/Playwright/security/concurrency tests.
- `ops/verify/stage12.sh`, sequential Stage 1–11 regression integration and an
  always-uploaded machine-readable diagnostic artifact.

## 18. Implementation sequence

1. Reconfirm Stage 11 baseline and commit the approved scope.
2. Add additive schema/migration, immutable constraints and restore integrity.
3. Implement bounded public projection and listing moderation with RBAC/audit.
4. Add draft preference and immutable checkout selection snapshot.
5. Extend the existing matcher/ranking and revalidation—no parallel matcher.
6. Add outbox/inbox projections, localized timeline/notifications and telemetry.
7. Build RU/UZ customer, partner and admin UI.
8. Add unit/integration and focused security/concurrency tests.
9. Add Stage 12 DB-E2E and RU/UZ Playwright E2E.
10. Update OpenAPI, ERD, architecture, state machine, threat model, RBAC,
    operations and testing docs.
11. Run the full local gate available in the workspace, then clean/repeated
    migrations and Docker verification on a capable host.
12. Commit logical changes, push `main`, run Stage 1–11 regressions followed by
    Stage 12 verification, fix root causes, and stop only after fully green CI.

No Stage 12 implementation begins until this proposal is separately approved.
