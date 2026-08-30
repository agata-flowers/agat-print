# AGAT PRINT MVP PRD

## Product value

AGAT PRINT lets a customer prepare a print job remotely, know the price before payment, and route it to a capable nearby studio. The pilot serves Tashkent in Russian and Uzbek and is optimized for weak mobile connections.

## Stage 1–5 release

This release establishes secure identity, partner onboarding and protected file
intake. An authenticated user can reserve quota, upload PDF, DOCX, JPG/JPEG or
PNG into private quarantine, receive bounded validation/antivirus rejection,
cancel an upload, and have an accepted file queued for isolated normalization.
Stage 4 adds preflight, immutable preview/print-ready versions, bounded manual
review and latest-version customer approval. Stage 5 adds versioned UZS
tariffs, order creation from that active approval, an immutable price snapshot,
mock payment and an idempotent full-refund foundation.

## MVP boundary

The full MVP will later accept only PDF, DOCX, JPG/JPEG, and PNG; produce immutable originals, derived previews, print-ready files, pricing snapshots, mock payments, partner assignment, manual partner printing, pickup/basic delivery, notifications, audit, and retention.

Excluded until separate approval: marketplace, essays/presentations, restoration, design/3D editors, subscriptions, corporate billing, printer integration, and custom courier optimization.

## Roles and stories

| Role               | Current story                        | Acceptance criterion                                                  |
| ------------------ | ------------------------------------ | --------------------------------------------------------------------- |
| Customer           | Sign in by phone without a password  | OTP expires, is single-use, attempt-limited, and creates safe cookies |
| Partner applicant  | Register a company and branch        | Record is pending and protected from partner-only access              |
| Administrator      | Review and approve a partner         | Approval is audited and grants the partner role atomically            |
| Courier            | Reserved role                        | No courier workflow exists before delivery stage                      |
| Authenticated user | Upload one supported private file    | Quota, signature, AV and isolation controls pass before persistence   |
| Customer           | Review and confirm the latest layout | Own private preview only; stale or concurrent approval is rejected    |
| Administrator      | Decide an uncertain photo review     | ADMIN-only decision is CAS-protected and safely audited               |
| Customer           | Pay the frozen total                 | Only a current approved print-ready layout can become an order        |
| Administrator      | Publish a tariff version             | Integer UZS values, ADMIN RBAC, immutable existing snapshots          |

## Non-functional requirements

- Mobile-first, RU/UZ, EN-ready, accessible controls.
- No sensitive caching, private data in telemetry, or production mock OTP.
- API contracts remain usable by future native applications.
- RPO ≤ 24 hours and RTO ≤ 4 hours with encrypted off-host backups.
- Critical state changes are transactional, idempotent, and auditable.

## Backlog sequence

1. Secure file intake and isolated conversion foundation — implemented.
2. Preflight, quality/manual review, preview, and approval — implemented.
3. Pricing, order state machine, and mock payment/refund — implemented.
4. Partner matching, offered payout snapshot, manual production.
5. Pickup, courier assignment, delivery, disputes, and retention automation.

## Legal decisions required before pilot

- Lawful basis, consent wording, data residency, processors, and cross-border transfer.
- Required retention for orders, payments, fiscal records, disputes, and audit.
- Official-photo disclaimers and accepted document templates.
- Payment tokenization, fiscal receipts, refunds, reconciliation, and partner payouts.
- Partner/courier contracts and responsibility for confidential print materials.
