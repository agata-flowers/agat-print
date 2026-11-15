# Stage 17.5 — Desktop UX Refinement & Automated Service Assignment Prototype

## Scope

Stage 17.5 refines only the autonomous marketplace prototype in
`apps/preview`. It does not change the NestJS API, Prisma schema, production
state machines, payments, or customer data.

- Desktop-first home composition with a compact header, sticky section menu,
  hero, prominent services, three promotions, popular quick services, product
  categories, and the existing non-repeating recommendation feed.
- A listing represents one product offer from exactly one synthetic seller.
  Seller entities and seller pages remain available, while customers add a
  listing directly instead of choosing an offer inside the product page.
- A complete product detail layout with gallery, variants, quantity, seller,
  stock, specifications, description, reviews, similar and recommended items.
- Service checkout no longer asks the customer to select a studio. A local,
  deterministic assignment simulator demonstrates eligibility filtering,
  ranking, offer timeout, refusal, next-candidate fallback, acceptance and the
  no-candidate outcome.
- Expanded mock customer profile for personal data, phones, addresses, product
  and service order history, tracking, favorites, reviews, notifications,
  language and support.
- RU, UZ and EN presentation coverage. Domain-like mock state stays locale
  independent.

## Acceptance criteria

1. The desktop layout is verified at 1280, 1366, 1440 and 1920 pixels without
   horizontal overflow; existing responsive/mobile behavior remains usable.
2. Every visible home control has a meaningful route or local interaction.
3. Product listings are seller-specific and the product page contains no
   manual offer selector.
4. Product cards add their exact listing to the cart and preserve seller
   grouping, quantity, favorites and seller navigation.
5. Service checkout captures parameters, files, fulfillment and confirmation,
   then starts automatic assignment without customer studio selection.
6. The assignment simulator proves decline, timeout, next candidate,
   deterministic acceptance, duplicate-assignment protection and no-candidate
   handling with synthetic data only.
7. The customer account sections, back-to-top control, search, filters, sort,
   cart, checkout and seller dashboard are interactive.
8. Playwright runs with retries disabled and covers home, product, cart,
   assignment, profile and all required desktop widths.
9. The Windows package runs on loopback without Docker or Node.js, chooses a
   free port automatically and contains Russian instructions.

## Explicit exclusions

- No backend, API, database or production changes.
- No real payment, fulfillment, assignment, personal data, seller inventory,
  client documents or external provider calls.
- No Stage 18 work and no merge to `main` without separate approval.
