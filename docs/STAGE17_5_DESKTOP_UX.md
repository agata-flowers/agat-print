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

## Approved-reference correction

The upper desktop home is implemented against the approved raster reference
at a 1440 px review viewport. This is a composition match, not a claim that
independently generated product photography is byte- or pixel-identical to
the source raster.

| Area             | Verified correspondence                                                                                          | Controlled difference / evidence                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Header           | One white row: configurable brand, location, search, favorites, cart, language and sign-in                       | Search retains an explicit submit action for keyboard and automation accessibility |
| Sidebar          | Sticky white eight-item navigation, burgundy active item, mobile-app/QR block                                    | QR is a clearly synthetic non-production mark                                      |
| Hero             | Burgundy horizontal banner, approved title/subtitle/yellow CTA, right-side printer/photo/merch composition       | Project-owned generated photography replaces the non-licensed raster subjects      |
| Main categories  | Seven equal pastel cards directly after the hero with isolated 3D illustrations and horizontal overflow fallback | Illustration details are project-owned rather than copied from the reference       |
| Promotions       | Three equal offer cards in the approved order and color rhythm                                                   | All prices and offers are explicitly synthetic demo content                        |
| Popular services | Eight compact equal illustrated cards in one row                                                                 | Product illustrations use a project-owned transparent sprite                       |

Review screenshots are captured at 1440 and 1920 px by the Stage 17.5
Playwright capture gate and packaged with the Windows prototype. Visual
acceptance remains a project-owner decision.

## Explicit exclusions

- No backend, API, database or production changes.
- No real payment, fulfillment, assignment, personal data, seller inventory,
  client documents or external provider calls.
- No Stage 18 work and no merge to `main` without separate approval.
