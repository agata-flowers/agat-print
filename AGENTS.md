# AGAT PRINT agent instructions

- Current authorized scope is stages 1–8: disputes (72-hour window, no evidence
  uploads), same-partner reprint cycles, full/partial refunds and object retention.
- Stage 7 baseline is c2865205180b9db913de97d3abcab8a8262440bb (Actions 33517487126).
- Stage 8 is explicitly approved. Do not start stage 9, marketplace expansion,
  new matching, route optimization or real payout settlement without approval.
- Keep the domain core in the NestJS modular monolith. External capabilities use provider interfaces.
- Never log OTPs, cookies, tokens, phone numbers, addresses, document contents, filenames, object keys, or signed URLs.
- Metrics may use only bounded enums and route templates. Never use IDs, IPs, query strings, request IDs, or user-controlled text as labels.
- API/auth/document responses are `Cache-Control: no-store, private`; service workers must never cache them.
- Run `pnpm run ci` before handoff. Run migrations against a clean PostgreSQL database when Docker is available.
- Secrets belong in the deployment secret store, never `.env.example`, Git, CLI arguments, logs, or CI output.
- Database changes require Prisma migration files and an update to the ERD/API documentation.
- Background work must use transactional outbox/inbox deduplication and idempotent provider operations.
