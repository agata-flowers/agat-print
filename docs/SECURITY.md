# Security, privacy, and incident policy

## Threat model

| Threat                       | Primary control                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| OTP brute force/reuse        | TTL, attempt/rate limits, digest comparison, single-use transaction                             |
| Session theft/replay         | Secure HttpOnly cookies, short access TTL, hashed rotating refresh tokens, family revocation    |
| CSRF                         | SameSite=Lax, Origin allowlist, double-submit token                                             |
| Broken object authorization  | Resource ownership and RBAC in the API, never UI-only checks                                    |
| Sensitive cache leakage      | `no-store, private` and service-worker network-only denylist                                    |
| Telemetry leakage            | Structured allowlists; no PII, secrets, URLs, IDs, or high-cardinality labels                   |
| Double processing            | Aggregate versions, outbox/inbox deduplication and provider idempotency                         |
| Polyglot or disguised file   | Extension/media-type/signature agreement and bounded parsers                                    |
| Malware or scanner outage    | Private quarantine, ClamAV before promotion, fail-closed outage policy                          |
| DOCX archive bomb/traversal  | Lazy ZIP metadata checks, entry/unpacked/ratio limits, normalized path rejection                |
| Image decompression bomb     | Dimension parsing and 40-megapixel decoded-image ceiling                                        |
| Converter escape             | One-shot non-root container, no network/secrets/capabilities, read-only root, seccomp/limits    |
| Duplicate processing         | Transactional outbox, BullMQ job ID, CAS lease, durable inbox and unique result                 |
| Stale/double layout approval | Latest-version check, serializable transaction, unique approval and aggregate CAS               |
| Manual-review privilege      | API ownership checks, ADMIN RBAC, bounded safe audit events                                     |
| Preview URL disclosure       | Private bucket, short TTL, no-store headers, no browser persistence or telemetry                |
| Price/payment tampering      | Integer UZS, immutable snapshot, signed callback, transition CAS and request hash               |
| Duplicate charge/refund      | Hashed idempotency keys, provider replay ledger, unique payment/refund and transactional outbox |
| Backup disclosure            | restic encryption, off-host access separation, 30-day expiry                                    |

## RBAC

| Capability                  | Customer | Pending partner | Approved partner | Courier | Admin          |
| --------------------------- | -------- | --------------- | ---------------- | ------- | -------------- |
| Own profile/session         | yes      | yes             | yes              | yes     | yes            |
| Submit partner application  | yes      | n/a             | n/a              | no      | yes            |
| Partner workspace           | no       | no              | yes, own         | no      | yes            |
| Approve partner             | no       | no              | no               | no      | yes            |
| Bootstrap admin             | no       | no              | no               | no      | CLI once only  |
| Create/cancel own upload    | yes      | yes             | yes              | yes     | yes            |
| Read upload object directly | no       | no              | no               | no      | no             |
| Read own latest preview     | yes      | yes             | yes              | yes     | yes, own       |
| Confirm own latest preview  | yes      | yes             | yes              | yes     | yes, own       |
| Decide manual review        | no       | no              | no               | no      | yes            |
| Create/read own order       | yes      | yes             | yes              | yes     | yes, own       |
| Publish tariff versions     | no       | no              | no               | no      | yes            |
| Request no-executor refund  | no       | no              | no               | no      | internal admin |

## Retention

Incomplete upload sessions, quarantine objects and processing temp: 24 hours
maximum, with eager cleanup on rejection/cancellation. Originals: 7 days after
terminal state; derivatives: 30 days; content-free technical/access audit:
90 days; encrypted backup snapshots: 30 days. Financial/legal record retention
remains a counsel decision. Restores apply deletion tombstones before API
exposure.

## Upload privacy invariants

- Client filenames are not accepted as identifiers and are neither persisted
  nor logged.
- Quarantine, original and result keys are opaque random/hash values without
  user IDs, phone numbers or other personal values.
- No object key or signed URL may enter logs, audit metadata, metrics,
  analytics, browser storage or service-worker cache.
- Antivirus and validation failures expose only bounded error codes.
- Quarantine is private and never served to a client or processing container
  before a clean verdict.
- Preview and print-ready objects are private and immutable. Signed URLs are
  short-lived, carry a no-store response override and are never stored by the
  PWA, analytics, audit or telemetry.
- Manual review exposes only the pending artifact to an authenticated admin;
  its audit record contains bounded status/result fields, never an object key.
- Card data is never accepted. Provider secrets, references, callback
  signatures, idempotency keys, money values and customer identifiers never
  enter logs, audit metadata or metric labels.
- The mock payment provider and `MOCK_PAYMENT_SECRET` fail production
  configuration validation. A production adapter must use the provider port
  and deployment secret store.

## Incident response

1. Detect and classify without copying sensitive payloads into tickets.
2. Contain by revoking sessions/provider credentials and isolating affected services.
3. Preserve minimal, access-controlled evidence and audit integrity.
4. Eradicate, rotate secrets, patch, and restore from verified backup if required.
5. Determine notification duties with counsel and the data-protection owner.
6. Record root cause, corrective controls, and restore/response timings.

# Stage 6 matching controls

Offer ownership is checked against the authenticated approved partner before
decisions, production changes or print-ready access. Order row locks, aggregate
CAS and a partial unique assignment index prevent double acceptance; expired
offers fail closed. Payout snapshots are immutable at both service and database
layers and are never included in customer responses, logs, audit metadata or
metrics. Signed print-ready URLs remain private, short-lived and no-store.
