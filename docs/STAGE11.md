# Stage 11 — Customer Ordering & Service Catalog MVP

## Goal and user value

Stage 11 turns the accepted Stage 1–10 platform into a usable customer product.
An ordinary mobile user must be able to complete the journey without knowing an
internal UUID, object key, provider reference or state-machine value:

`home → catalog → service/options → file → processing → preview → approval → quote → checkout → order/timeline → completion`

The implementation composes the existing upload, processing, layout, pricing,
payment, matching, fulfillment, aftercare and finance aggregates. It must not
introduce another processing pipeline, matcher, payment flow or order state
machine.

## Functional scope

- An immutable, versioned platform catalog for extensible print/photo services.
  Initial bounded codes are `DOCUMENT_PRINT`, `PHOTO_PRINT` and `ID_PHOTO`;
  future bounded services are data/configuration additions rather than ordering
  pipeline rewrites.
- Published service definitions include RU/UZ customer copy, accepted file
  kinds and bounded option definitions for size, paper, colour, DPI and quantity.
  They map to the same service codes consumed by Stage 10 branch catalogs.
- A resumable, owner-scoped order draft links one service configuration to the
  existing upload, layout and latest approval. Source/configuration changes
  invalidate stale approval and quote through the existing invariants.
- An immutable, expiring quote freezes catalog/tariff versions and canonical
  inputs. Checkout recomputes the final integer-amount UZS `PriceSnapshot` on
  the server and rejects stale catalog, tariff, source, layout or approval.
- Mobile-first PWA screens provide catalog discovery, a guided new-order flow,
  upload progress/retry, processing/manual-review/quality states, preview,
  approval, quote, checkout, payment continuation, order list/timeline,
  pickup/delivery, aftercare and a durable notification inbox.
- RU and UZ cover the complete primary customer flow. EN remains an explicit
  fallback-ready locale, not a source of mixed technical messages.
- Durable bounded in-app notifications are created from transactional outbox
  events. Optional external delivery stays behind the existing provider port;
  its failure cannot lose an in-app notification or roll back domain state.

Stage 11 retains one print-ready artifact and one partner per order. A customer
draft is a checkout draft, not a multi-line retail basket.

## Domain and database scope

- `PlatformCatalogVersion`, immutable catalog items/options and publication
  status.
- Immutable pricing rules attached to the existing `TariffVersion` while
  preserving the legacy base/per-page tariff contract.
- Versioned `OrderDraft` with a single active configuration, lifecycle and
  optional links to its existing upload/layout/approval.
- Immutable, expiring `PriceQuote` with catalog/tariff/configuration lineage.
- Append-only bounded `CustomerOrderEvent` timeline projections.
- `UserNotification`, durable delivery attempt/job state and optional locale
  preference.
- Nullable lineage on existing orders for backwards compatibility. Historical
  orders, `PriceSnapshot`, `PartnerPayoutSnapshot`, fiscal and ledger records
  are never rewritten.

Database constraints and immutable triggers enforce published catalog history,
quote lineage, one checkout result per draft, notification deduplication and
append-only timeline records.

## API contract

REST stays under `/api/v1`. The Stage 11 surface includes public published
catalog reads; authenticated owner-only draft, quote, checkout, order-list,
timeline and notification operations; and ADMIN-only catalog publication.
Every mutation requires `Idempotency-Key`, except the existing byte-upload
operation whose established upload-session contract remains authoritative.

Existing upload/layout/order/payment endpoints remain compatible. New customer
responses expose localized labels and bounded presentation states, never raw
internal state names, provider identifiers, payout/commission data or storage
identifiers. Payment continuation is provider-neutral; development mock details
must not be embedded in production UI behavior.

## Security, privacy and recovery

- CUSTOMER can access only its own drafts, quotes, uploads, layouts, orders,
  timelines and notifications. PARTNER/COURIER boundaries remain unchanged.
- Catalog administration is ADMIN-only and safely audited with bounded fields.
- Server-side validation is authoritative for service options, file kind,
  quantity, quote and final price. Client totals are never trusted.
- Aggregate version CAS serializes configuration, quote and checkout. Duplicate
  checkout creates at most one order/payment path; same-key changed payload
  conflicts. Notification redelivery creates no duplicate inbox item.
- API/customer/document responses are `no-store, private`; the service worker
  is network-only for drafts, quotes, uploads, layouts, orders, notifications,
  payment actions and signed URLs.
- Browser persistence contains only non-sensitive locale/navigation state. It
  never contains file bytes, preview URLs, object keys, auth material, address,
  phone, provider data or personal text.
- Refresh, re-login and temporary network loss resume from server-side draft or
  order state. Errors are localized and bounded; stack traces and identifiers
  are not presented.
- Draft/quote cleanup follows an explicit short-lived policy. Order/financial
  records are not deleted; existing legal holds and tombstone replay remain
  authoritative.

## Required tests

- Unit: catalog/option validation, tariff rules using integer money, canonical
  quote hashing, RU/UZ fallback, presentation-state mapping, notification
  deduplication and service-worker policy.
- Integration/API: publication RBAC/audit, ownership isolation, idempotency
  replay/conflict, localized safe errors and customer projections.
- DB-E2E: PDF, DOCX, JPG/JPEG and PNG through the customer draft flow; invalid
  options; stale catalog/tariff/layout/approval/quote; concurrent checkout;
  resume/recovery; partner eligibility; timeline/privacy; notification
  redelivery; cleanup and retention.
- Browser E2E: at least one real UI journey from catalog through upload,
  processing/layout, approval, quote, checkout and order timeline using the
  existing internal API/domain boundaries.
- Full Stage 1–10 regression, clean/repeated migrations, Prisma
  generate/validate, frozen install, format/lint/typecheck/tests/build, Docker
  Compose, Redis/BullMQ, MinIO/processing, backup/isolated restore and measured
  RPO/RTO.

## Acceptance criteria

1. The primary journey is completable through responsive RU/UZ UI without
   manually entering or seeing internal identifiers.
2. All four accepted format families pass the customer DB-E2E flow and at least
   one passes the browser E2E flow.
3. Catalog data is extensible and versioned; the three initial service codes do
   not create hard-coded branches in the ordering orchestration.
4. Checkout is server-authoritative and refuses every stale lineage variant.
5. Concurrent/repeated checkout cannot create a second order or payment path.
6. Existing Stage 10 matching consumes the selected service/options and cannot
   offer an incompatible partner.
7. Order history, timeline and notifications are localized, owner-isolated and
   contain no payout, commission, provider or storage internals.
8. Drafts and orders resume after refresh, re-login and retryable network loss.
9. Security/cache/telemetry/privacy gates and all Stage 1–10 regressions pass.
10. Final `main` has successful `quality` and `infrastructure` jobs and a
    successful `stage11-verification-report` containing final SHA, DB/browser
    E2E, regression result, backup RPO/RTO and a published artifact digest.

## Explicitly out of scope

- inventory-backed stationery/SKU sales, stock reservation and physical-goods
  returns;
- multi-line or multi-partner baskets and automatic order splitting;
- customer partner browsing/selection, GPS tracking or route optimization;
- new file formats, document/photo editors, subscriptions, loyalty or corporate
  billing;
- new vendor-specific OTP/payment/fiscal/payout integrations;
- Stage 12 design or implementation.

## External blockers

Real OTP/SMS, acquiring, fiscal, payout, delivery, outbound notification and
optional geocoding providers require contracts, certified endpoints and
secret-store credentials. CI verifies the provider-neutral boundaries and
durable internal behavior; it cannot certify real external operations without
those dependencies.
