# AGAT PRINT agent instructions

- Current authorized scope is planning, platform foundation, and the protected
  upload/isolated processing foundation (stages 1–3) only.
- Stage 3 was explicitly approved on 2026-08-28. Do not implement user preview,
  full preflight, manual review, layout approval, orders, pricing, payments,
  dispatch, production queues, printing, or delivery without explicit stage 4
  approval.
- Keep the domain core in the NestJS modular monolith. External capabilities use provider interfaces.
- Never log OTPs, cookies, tokens, phone numbers, addresses, document contents, filenames, object keys, or signed URLs.
- Metrics may use only bounded enums and route templates. Never use IDs, IPs, query strings, request IDs, or user-controlled text as labels.
- API/auth/document responses are `Cache-Control: no-store, private`; service workers must never cache them.
- Run `pnpm run ci` before handoff. Run migrations against a clean PostgreSQL database when Docker is available.
- Secrets belong in the deployment secret store, never `.env.example`, Git, CLI arguments, logs, or CI output.
- Database changes require Prisma migration files and an update to the ERD/API documentation.
- Background work must use transactional outbox/inbox deduplication and idempotent provider operations.
