# Stage 17.6 — Premium Marketplace Internal Pages

Status: frontend prototype implementation. Visual acceptance remains with the
product owner. This stage does not change the production API, database, domain
state machines, payments, delivery providers, or `main`.

## Goal

Bring the internal marketplace pages and their transitions to the same visual
and functional level as the approved Stage 17.5 home page, while keeping all
data synthetic and browser-local.

## Page map

- `/marketplace/catalog` — hierarchical product catalogue, search suggestions,
  category/subcategory, price, rating and availability filters, sorting and
  recommendations.
- `/marketplace/product/:listing` — seller-specific listing with gallery,
  variants, stock, delivery information, reviews, related products and direct
  cart or buy-now actions.
- `/marketplace/cart` → `/marketplace/checkout` — seller-grouped physical goods
  and explicitly labelled demo checkout.
- `/marketplace/service/:service` — a dedicated validated service wizard with
  parameters, synthetic file input, honest preview, fulfillment and estimate.
- service confirmation → automatic assignment simulation — deterministic
  candidates, decline, timeout, next candidate, acceptance and no-candidate
  state. This does not call the production matcher.
- `/marketplace/account/*` — overview, identity, phone, addresses, product and
  service orders, order details/tracking, repeat order, favorites,
  notifications, reviews, language/settings and support.
- `/marketplace/store/:seller` — seller storefront and seller-specific
  listings.
- `/marketplace/seller/*` — local seller onboarding, assortment creation and
  editing, stock/price controls, orders, analytics and store settings.

All non-home routes include breadcrumbs. Navigation and local state survive
route transitions and reloads where applicable. Visible actions either change
state, navigate, validate input, or explicitly explain the demo limitation.

## Localization and privacy

Customer-facing UI is available in exactly `ru`, `uz`, and `en`. Domain-like
demo state remains language-independent. Uploaded demo files stay in browser
memory; no file, address, phone, or profile data is sent to a backend. Payment,
delivery, seller verification and production are clearly marked as synthetic.

## Verification

Stage 17.6 requires:

- preview unit, lint, typecheck and production build;
- all existing preview Playwright suites with retries disabled;
- Stage 17.6 catalogue, product, checkout, service assignment, account,
  seller, localization and 1366/1440/1920 width scenarios;
- screenshot capture for catalogue, product, service, account and seller;
- a self-contained Windows ZIP using the loopback-only launcher with automatic
  free-port selection and no Docker or Node.js dependency;
- the existing sequential CI gates remain green.

## Demonstration limitations

- all products, prices, stock, sellers, reviews, orders and statistics are
  synthetic;
- no real payment, delivery, file processing, order, matching or seller
  verification occurs;
- image upload previews use browser-local data only;
- visual approval is required before any backend integration.
