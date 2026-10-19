# Stage 16.1F — Functional Web Pilot

## Goal

Stage 16.1F turns the existing `apps/web` customer and studio surfaces into an
owner-runnable functional pilot. It reuses the Stage 1–15 NestJS API,
PostgreSQL aggregates, processing pipeline, commerce, matching and fulfilment
state machines. It must not introduce a second Web application, backend,
pricing path or matching path.

The Stage 16.1 visual preview remains a presentation-only artifact. Production
mutations are performed only by `apps/web` through `/api/v1`.

## Functional pilot journey

The accepted end-to-end journey is:

1. customer opens the home page and service catalog;
2. customer selects a service and print options;
3. customer signs in with the development OTP adapter;
4. customer uploads PDF, DOCX, JPG/JPEG or PNG;
5. the existing protected processing pipeline produces a layout;
6. customer reviews and approves the latest layout;
7. customer adds one or more approved items to a basket;
8. the server creates the authoritative quote and immutable price snapshot;
9. customer checks out and uses the development payment adapter;
10. existing matching offers the paid order to an eligible pilot studio;
11. an authenticated studio employee accepts the offer, downloads the
    print-ready artifact and moves production to `READY`;
12. the existing pickup or delivery flow completes the order.

## Compatibility and security boundaries

- Existing Stage 1–15 domain transitions and `/api/v1` contracts remain
  authoritative.
- Layout preflight requested by the containerized Web pilot is dispatched by
  the existing transactional outbox to the trusted processing worker. The API
  never receives Docker-socket access, and the worker still runs each input in
  the existing networkless, one-job processing runtime. Duplicate queue
  delivery is bounded by the layout revision plus the inbox deduplication key.
- Mock OTP, payment and fiscal providers are development/test only. Production
  configuration remains fail-closed.
- Authentication continues to use HttpOnly cookies, CSRF and Origin checks.
- Documents, API responses and signed URLs remain `no-store, private` and are
  excluded from the service-worker cache.
- Customer-visible copy is complete for exactly `uz`, `ru` and `en`. Raw
  enums, provider codes, UUIDs, object keys and internal errors are not copy.
- Pilot fixtures are deterministic, idempotent and synthetic. They contain no
  real phone numbers, addresses, documents or provider credentials.
- The pilot launcher must not print secrets, OTPs, object keys or signed URLs.

## Delivery checkpoints

### Checkpoint 1 — connected customer path

- Apply the Stage 16.1 design system to the real customer Web.
- Keep catalog, configuration, upload, layout, basket, checkout, payment and
  timeline buttons connected to their existing API operations.
- Complete safe `uz`, `ru` and `en` presentation for the connected path.
- Prove the path with unit/build checks and a no-retry browser test against the
  real API when Docker infrastructure is available.

### Checkpoint 2 — connected studio workspace

- Present offers and active orders without exposing internal identifiers.
- Allow authorised employees to accept/reject, download assigned print-ready
  artifacts and move item/order production through valid forward transitions.
- Preserve partner isolation, idempotency and the existing assignment lock.

### Checkpoint 3 — repeatable owner environment

- Add an idempotent pilot seed for a synthetic customer, active AGAT PRINT
  studio, branch, catalog, tariff, capabilities, availability and capacity.
- Add a Windows launcher that checks Docker Desktop, starts the required
  profiles, applies migrations and seed data, waits for readiness, and opens
  the Web application without manual configuration editing.

### Checkpoint 4 — final acceptance

- Playwright covers customer and studio browser contexts with `retries=0`.
- PDF, DOCX, JPG/JPEG and PNG retain Stage 3–15 coverage.
- Full Stage 1–15 regression, clean/repeated migrations, processing isolation,
  backup/restore and security checks pass on one commit.
- CI publishes a checksummed Windows functional-pilot artifact and a
  machine-readable verification report.

## Out of scope

- Capacitor, Android APK, iOS and Tauri shells (Stage 16.2+);
- public production hosting;
- real SMS, acquiring, fiscal, maps or delivery providers;
- new pricing, matching, fulfilment or document-processing implementations;
- physical printer compatibility certification.
