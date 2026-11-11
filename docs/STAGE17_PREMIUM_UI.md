# Stage 17 — AGAT PRINT Premium UI Prototype

## Scope

Stage 17 is an isolated, browser-only UX/UI prototype at `/premium`. It preserves the
existing Stage 1–16 implementation and does not call or modify the API, database,
payments, delivery or production flows. All catalog entries and UZS prices are synthetic
demonstration data and are labelled as such.

The responsive prototype covers nine extensible categories: ID photos, printing,
outdoor advertising, presentations/reports, coursework, graphic design, stationery,
gifts and accessories. It provides search, category navigation, product details,
favorites, a persistent cart, quantity controls, locale switching and a varied infinite
feed. Product detail navigation preserves the list scroll position.

## Locales and safety

All customer text is supplied in `uz`, `ru` and `en`. Domain state does not depend on
language. The static Windows package binds only to `127.0.0.1`, sends `no-store` and a
restrictive CSP, and has no network/API transport. It cannot place an order or perform a
payment or delivery action.

## Run without Docker

For development: `pnpm --filter @agat/platform-preview dev`, then open
`http://127.0.0.1:4173/premium?lang=ru`.

For a non-developer on Windows, download and extract the
`stage17-premium-ui-prototype` artifact, then run
`Start-AGAT-Premium-Prototype.cmd`. Docker and Node.js are not required.

## Review checklist

- Desktop, tablet and 390 px mobile layouts.
- Search, category filters and non-repeating feed loading.
- Product modal, option selection and return to the previous feed position.
- Favorites and cart persistence, quantity/remove controls.
- RU/UZ/EN switching without losing cart state.
- Clear demo boundaries for prices, checkout, payment and delivery.

Backend integration is intentionally deferred until the design is approved.
