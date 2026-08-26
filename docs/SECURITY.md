# Security, privacy, and incident policy

## Threat model

| Threat                      | Primary control                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| OTP brute force/reuse       | TTL, attempt/rate limits, digest comparison, single-use transaction                          |
| Session theft/replay        | Secure HttpOnly cookies, short access TTL, hashed rotating refresh tokens, family revocation |
| CSRF                        | SameSite=Lax, Origin allowlist, double-submit token                                          |
| Broken object authorization | Resource ownership and RBAC in the API, never UI-only checks                                 |
| Sensitive cache leakage     | `no-store, private` and service-worker network-only denylist                                 |
| Telemetry leakage           | Structured allowlists; no PII, secrets, URLs, IDs, or high-cardinality labels                |
| Double processing           | Aggregate versions, outbox/inbox deduplication and provider idempotency                      |
| Malicious documents         | Future isolated converter, signature/MIME checks, antivirus, quotas                          |
| Backup disclosure           | restic encryption, off-host access separation, 30-day expiry                                 |

## RBAC

| Capability                 | Customer | Pending partner | Approved partner | Courier | Admin         |
| -------------------------- | -------- | --------------- | ---------------- | ------- | ------------- |
| Own profile/session        | yes      | yes             | yes              | yes     | yes           |
| Submit partner application | yes      | n/a             | n/a              | no      | yes           |
| Partner workspace          | no       | no              | yes, own         | no      | yes           |
| Approve partner            | no       | no              | no               | no      | yes           |
| Bootstrap admin            | no       | no              | no               | no      | CLI once only |

## Retention

Incomplete uploads/temp: 24 hours; originals: 7 days after terminal state; preview/derivatives/print-ready: 30 days; content-free technical/access audit: 90 days; encrypted backup snapshots: 30 days. Financial/legal record retention remains a counsel decision. Restores apply deletion tombstones before API exposure.

## Incident response

1. Detect and classify without copying sensitive payloads into tickets.
2. Contain by revoking sessions/provider credentials and isolating affected services.
3. Preserve minimal, access-controlled evidence and audit integrity.
4. Eradicate, rotate secrets, patch, and restore from verified backup if required.
5. Determine notification duties with counsel and the data-protection owner.
6. Record root cause, corrective controls, and restore/response timings.
