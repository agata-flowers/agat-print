# AGAT PRINT MVP PRD

## Product value

AGAT PRINT lets a customer prepare a print job remotely, know the price before payment, and route it to a capable nearby studio. The pilot serves Tashkent in Russian and Uzbek and is optimized for weak mobile connections.

## Stage 1–2 release

This release establishes secure identity and partner onboarding. A customer can request and verify a development OTP, create a profile, and maintain a session. A partner can register a legal/display name and one branch, then wait for administrator approval. An administrator can approve the partner. No customer document is accepted.

## MVP boundary

The full MVP will later accept only PDF, DOCX, JPG/JPEG, and PNG; produce immutable originals, derived previews, print-ready files, pricing snapshots, mock payments, partner assignment, manual partner printing, pickup/basic delivery, notifications, audit, and retention.

Excluded until separate approval: marketplace, essays/presentations, restoration, design/3D editors, subscriptions, corporate billing, printer integration, and custom courier optimization.

## Roles and stories

| Role              | Stage 2 story                       | Acceptance criterion                                                  |
| ----------------- | ----------------------------------- | --------------------------------------------------------------------- |
| Customer          | Sign in by phone without a password | OTP expires, is single-use, attempt-limited, and creates safe cookies |
| Partner applicant | Register a company and branch       | Record is pending and protected from partner-only access              |
| Administrator     | Review and approve a partner        | Approval is audited and grants the partner role atomically            |
| Courier           | Reserved role                       | No courier workflow exists before delivery stage                      |

## Non-functional requirements

- Mobile-first, RU/UZ, EN-ready, accessible controls.
- No sensitive caching, private data in telemetry, or production mock OTP.
- API contracts remain usable by future native applications.
- RPO ≤ 24 hours and RTO ≤ 4 hours with encrypted off-host backups.
- Critical state changes are transactional, idempotent, and auditable.

## Backlog sequence

1. Secure file intake and isolated conversion.
2. Preflight, quality/manual review, preview, and approval.
3. Pricing, order state machine, and mock payment/refund.
4. Partner matching, offered payout snapshot, manual production.
5. Pickup, courier assignment, delivery, disputes, and retention automation.

## Legal decisions required before pilot

- Lawful basis, consent wording, data residency, processors, and cross-border transfer.
- Required retention for orders, payments, fiscal records, disputes, and audit.
- Official-photo disclaimers and accepted document templates.
- Payment tokenization, fiscal receipts, refunds, reconciliation, and partner payouts.
- Partner/courier contracts and responsibility for confidential print materials.
