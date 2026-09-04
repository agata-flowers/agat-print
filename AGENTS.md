# AGAT PRINT agent instructions

- Current authorized scope is stages 1–9. Stage 9 is Production Pilot Readiness:
  production OTP/payment adapter boundaries, fiscal operations, partner payout
  ledger/settlement batches and financial reconciliation.
- Stage 8 baseline is c32f6ad92eefd5c35c9dc4beb751e081a35e127e
  (Actions 33881277674).
- Stage 9 is explicitly approved. Do not start stage 10, marketplace expansion,
  new matching, route optimization or unrelated product features without approval.
- Keep the domain core in the NestJS modular monolith. External capabilities use provider interfaces.
- Never log OTPs, cookies, tokens, phone numbers, addresses, document contents, filenames, object keys, or signed URLs.
- Metrics may use only bounded enums and route templates. Never use IDs, IPs, query strings, request IDs, or user-controlled text as labels.
- API/auth/document responses are `Cache-Control: no-store, private`; service workers must never cache them.
- Run `pnpm run ci` before handoff. Run migrations against a clean PostgreSQL database when Docker is available.
- Secrets belong in the deployment secret store, never `.env.example`, Git, CLI arguments, logs, or CI output.
- Database changes require Prisma migration files and an update to the ERD/API documentation.
- Background work must use transactional outbox/inbox deduplication and idempotent provider operations.
