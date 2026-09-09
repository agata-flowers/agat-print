# AGAT PRINT agent instructions

- Current authorized scope is stages 1–12. Stage 11 is Customer Ordering &
  Service Catalog MVP: a mobile-first RU/UZ customer journey over the existing
  upload, processing, layout, commerce, matching, fulfillment and finance
  aggregates, plus an extensible platform catalog, server-authoritative quote,
  resumable order draft, order timeline and durable in-app notifications.
- Stage 9 baseline is 49d108ca88c045d16c05650ed3b4e2fe7fa5072a
  (Actions 33978772270).
- Stage 12 is Customer Studio Marketplace & Controlled Partner Preference.
  Do not start or design Stage 13, multi-partner carts, inventory-backed stationery sales,
  route optimization or unrelated product features without approval.
- Keep the domain core in the NestJS modular monolith. External capabilities use provider interfaces.
- Never log OTPs, cookies, tokens, phone numbers, addresses, document contents, filenames, object keys, or signed URLs.
- Metrics may use only bounded enums and route templates. Never use IDs, IPs, query strings, request IDs, or user-controlled text as labels.
- API/auth/document responses are `Cache-Control: no-store, private`; service workers must never cache them.
- Run `pnpm run ci` before handoff. Run migrations against a clean PostgreSQL database when Docker is available.
- Secrets belong in the deployment secret store, never `.env.example`, Git, CLI arguments, logs, or CI output.
- Database changes require Prisma migration files and an update to the ERD/API documentation.
- Background work must use transactional outbox/inbox deduplication and idempotent provider operations.
