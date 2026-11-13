# Stage 17.2 — Premium Marketplace Layout & Design System Refinement

## Purpose

Stage 17.2 refines the isolated `/premium` presentation prototype into a
coherent marketplace layout. Uzum Market was used only as a reference for
proportion, density, navigation, and interaction conventions. No external
brand assets, logos, product images, or distinctive trade dress are copied.

The NestJS backend, API, database, production application, and accepted domain
behavior are unchanged.

## Design system

- One token layer controls the 1240 px content container, adaptive gutters,
  spacing, type scale, control heights, corner radii, and shadows.
- Desktop uses a compact two-row marketplace header and a horizontal category
  ribbon instead of a permanent sidebar.
- Product media has a consistent 3:4 ratio. Wide desktop shows five cards per
  row, then progressively adapts to four, three, and two columns.
- Interactive controls have visible hover/focus states and practical touch
  targets. Reduced-motion preferences remain respected.
- The interface is explicitly tested at 1440, 1024, 768, 430, and 375 px and
  must never create horizontal page overflow.

## Information architecture

Services and products remain different customer journeys:

- six print services open dedicated validated multi-step masters;
- five product groups use details, variants, favorites, quantity controls, and
  the local demonstration cart;
- a service never enters the product cart.

Curated popular, new, and personal shelves precede the long recommendation
feed. Product IDs are partitioned between shelves and the feed, so visible
cards do not repeat. Further unique synthetic products are loaded in batches
as the visitor approaches the end of the page.

## Localization and data

All customer-facing copy is present in exactly `uz`, `ru`, and `en`. Changing
language preserves cart and favorites. All catalog, pricing, file, and order
data is synthetic and browser-local; it is visibly marked as demonstration
content.

## Autonomous Windows prototype

CI packages the static production build with a loopback-only PowerShell HTTP
server. The archive needs neither Docker nor Node.js. It selects the first free
port in `4173-4183`, applies `Cache-Control: no-store, private`, and uses a CSP
that blocks outbound connections.

## Acceptance evidence

- preview unit, lint, type, and production-build checks;
- Playwright with retries `0` for search, product details, favorites, cart
  persistence and quantities, navigation, six service masters, validation,
  language switching, unique infinite loading, and responsive layout;
- desktop and mobile review screenshots;
- machine-readable verification report and SHA-256 digests;
- autonomous Windows ZIP artifact.

Backend integration and Stage 18 are outside this stage.
