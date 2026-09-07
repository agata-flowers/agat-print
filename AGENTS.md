# AGAT PRINT agent instructions

- Current authorized scope is stages 1–10. Stage 10 is Partner Marketplace &
  Production Network and extends the existing Stage 6 matching aggregate with
  moderated partner lifecycle, immutable branch configuration, eligibility,
  capacity reservations and explainable ranking.
- Stage 9 baseline is 49d108ca88c045d16c05650ed3b4e2fe7fa5072a
  (Actions 33978772270).
- Stage 10 is explicitly approved. Do not start Stage 11, customer marketplace
  browsing, route optimization or unrelated product features without approval.
- Keep the domain core in the NestJS modular monolith. External capabilities use provider interfaces.
- Never log OTPs, cookies, tokens, phone numbers, addresses, document contents, filenames, object keys, or signed URLs.
- Metrics may use only bounded enums and route templates. Never use IDs, IPs, query strings, request IDs, or user-controlled text as labels.
- API/auth/document responses are `Cache-Control: no-store, private`; service workers must never cache them.
- Run `pnpm run ci` before handoff. Run migrations against a clean PostgreSQL database when Docker is available.
- Secrets belong in the deployment secret store, never `.env.example`, Git, CLI arguments, logs, or CI output.
- Database changes require Prisma migration files and an update to the ERD/API documentation.
- Background work must use transactional outbox/inbox deduplication and idempotent provider operations.
