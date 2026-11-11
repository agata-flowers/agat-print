# Stage 17.1 — Premium UI/UX Redesign

## Purpose

Stage 17.1 is an isolated, synthetic presentation prototype for visual approval.
It redesigns the Stage 17 `/premium` experience without changing the NestJS
backend, API, database, production configuration, or accepted domain behavior.

## Interaction model

- Print services and marketplace products are deliberately separate.
- Six services have dedicated three-step flows: configuration, file/brief
  collection, estimate review, and an explicit demo confirmation.
- A service never enters the physical-product cart.
- Products support details, variants, favorites, quantities, cart persistence,
  search, categories, and an infinite non-duplicating feed.
- Demo service state, cart, and favorites are browser-local synthetic data.

## Supported service demonstrations

1. ID photos.
2. Document and photo printing.
3. Outdoor advertising.
4. Presentations and reports.
5. Coursework printing and binding.
6. Graphic design.

Each flow validates required fields and produces a preliminary integer UZS
estimate. No order, payment, upload, or delivery request is sent over a network.

## Presentation and accessibility

- Brand colors: `#58221B` and `#FEFEFE` with accessible supporting tones.
- Responsive layouts for desktop, tablet, and mobile viewports.
- Larger type, controls, product cards, service cards, and hit targets.
- Inline thematic SVG icon system; no letter-code category placeholders.
- Visible hover, focus, selected, validation, empty, and success states.
- Full customer copy in exactly `uz`, `ru`, and `en`.
- Reduced-motion preference is respected.

## Windows prototype

The CI artifact contains a static production build and a loopback-only
PowerShell server. It requires neither Docker nor Node.js. If port 4173 is
occupied, the launcher selects the first free loopback port through 4183 and
prints the resulting URL.

## Security boundaries

- Synthetic data only.
- Loopback listener only (`127.0.0.1`).
- `Cache-Control: no-store, private`.
- CSP denies outbound connections (`connect-src 'none'`).
- No credentials, personal files, production records, or provider calls.

## Verification

- Unit tests verify six distinct, tri-lingual service definitions.
- Playwright verifies product interactions, persistence, infinite feed,
  dedicated service flow, file selection, validation, estimates, cart
  separation, mobile controls, and `uz`/`ru`/`en` switching with retries `0`.
- CI creates desktop/mobile screenshots and an autonomous Windows ZIP.

Stage 18 and backend integration are outside this scope.
