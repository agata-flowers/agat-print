# AGAT PRINT agent instructions

- Current authorized scope is planning documentation and foundation (stages 1–2) only.
- Do not implement uploads, document conversion, OCR/CV, preflight, orders, pricing, payments, dispatch, production queues, or delivery without explicit stage 3 approval.
- Keep the domain core in the NestJS modular monolith. External capabilities use provider interfaces.
- Never log OTPs, cookies, tokens, phone numbers, addresses, document contents, filenames, object keys, or signed URLs.
- Metrics may use only bounded enums and route templates. Never use IDs, IPs, query strings, request IDs, or user-controlled text as labels.
- API/auth/document responses are `Cache-Control: no-store, private`; service workers must never cache them.
- Run `pnpm run ci` before handoff. Run migrations against a clean PostgreSQL database when Docker is available.
- Secrets belong in the deployment secret store, never `.env.example`, Git, CLI arguments, logs, or CI output.
- Database changes require Prisma migration files and an update to the ERD/API documentation.
- Background work must use transactional outbox/inbox deduplication and idempotent provider operations.
