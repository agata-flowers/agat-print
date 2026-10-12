# Stage 16 Proposal — Cross-Platform Foundation & Installable Pilot Clients

Status: platform architecture preliminarily approved; decomposed delivery plan
awaiting final explicit approval. No Stage 16 implementation is authorized by
this document.

Baseline: accepted Stage 1–15 `main` commit
`6cbf28b8fcb21ba9a6509dca34d4832416795dd7`. The complete platform decision
record is [APP_PLATFORM_STRATEGY.md](../APP_PLATFORM_STRATEGY.md).

## 1. Goal and measurable product outcome

Stage 16 turns the accepted Web product into one multi-client platform without
forking its domain. It must produce:

1. the unchanged complete Web customer experience;
2. an installable Android pilot APK exercising the real customer journey;
3. an iOS simulator build and executable physical-device/TestFlight plan;
4. an installable Windows studio/operator pilot connected to the existing
   partner, production and printer-agent contracts;
5. the existing Web Admin over the same users, orders, payments and statuses;
6. a customer who starts a draft/basket/order in Web and resumes it in the
   mobile app after authenticating.

The stage is a platform foundation and pilot-delivery vertical. It does not add
a new catalog, order, payment, matching, production or fulfillment model.

## 2. In scope

### 2.1 Shared client foundation

- OpenAPI-derived typed API client with stable error normalization and a CI
  drift check.
- Shared `uz`, `ru`, `en` catalog with compile-time key completeness and no
  new inline customer-visible strings.
- Shared headless customer flow/state models for auth, catalog, draft, basket,
  upload, layout, quote, checkout, payment continuation, timeline and recovery.
- Platform interfaces for secure storage, file selection, camera, deep links,
  notifications, connectivity and lifecycle.
- Existing Next.js Web/Web Admin remain deployable independently.

### 2.2 Native identity and device lifecycle

- Additive native session endpoints in the existing identity module.
- Short-lived bearer access token in memory; rotating refresh token in OS
  secure storage; database stores digest only.
- Session family reuse detection, per-installation revoke, logout and bounded
  device/session inventory.
- Browser cookie/CSRF flow remains byte-for-byte compatible in behavior.
- Cross-device resume relies only on server-owned drafts, baskets, orders and
  notifications.

### 2.3 Android and iOS customer application

- `apps/mobile` static React client wrapped by Capacitor for Android/iOS.
- Mobile-first `uz/ru/en` journey over existing API: login, catalog, create and
  resume draft, select/capture file, processing/layout, basket, quote, payment
  continuation, order/timeline and notifications.
- System camera/file picker, private temporary files and native streaming/
  resumable upload.
- Universal Links/App Links for allow-listed owned resources.
- Durable in-app notifications always work; optional push uses a provider port.
- Offline shell and explicit connection/retry states; no offline commercial
  mutation or local source of truth.
- Reproducible Android debug APK and test AAB; iOS simulator build.

### 2.4 Resumable upload transport

- Extend existing upload session with backward-compatible chunk/offset/checksum
  operations and finalization CAS.
- Preserve 25 MiB file, 100-page, 250 MiB active quota and 40 MP defaults.
- Finalization reuses existing MIME/extension/signature, DOCX, image, AV,
  quarantine and processing controls.
- Duplicate chunks/finalize are idempotent; changed bytes conflict; expiry and
  cancel clean all temporary objects.
- Existing Web single-PUT route remains supported during migration.

### 2.5 Windows studio/operator pilot

- `apps/studio-desktop` using Tauri 2 and React.
- Add branch staff membership and least-privilege `STUDIO_OPERATOR` authority,
  without granting partner owner/admin rights.
- Operator surfaces: offers assigned to their branch, active order/items,
  download-for-print, machine status, print job state and manual production
  transitions already allowed by the existing state machine.
- Secure one-time machine enrollment; printer machine token in Windows
  Credential Manager, never in WebView/env/logs.
- Existing printer-agent protocol extracted and reused. Headless agent remains
  supported as rollback/fallback.
- Tauri native core downloads and validates only the leased job and writes it
  through an allow-listed spool provider. Stage 16 acceptance uses an isolated
  spool-directory/virtual printer adapter.
- Internal Windows installer, clean install/uninstall and signed-update
  verification behavior. Production signing remains externally gated.

### 2.6 Notification/device provider boundary

- Add owner-scoped device installation and encrypted push endpoint records.
- Add provider-neutral push adapter driven by existing outbox/inbox jobs.
- Push contains only bounded event code/opaque notification reference.
- Missing real FCM/APNs configuration does not block the app: in-app
  notifications and polling remain complete.

### 2.7 CI, documentation and operations

- Android build/emulator, iOS simulator and Windows build/VM jobs.
- npm/Cargo/Gradle/iOS dependency audit, SBOM and provenance artifacts.
- Platform threat model, store/privacy checklist, signing/update/enrollment
  runbooks and support matrix.
- Full Stage 1–15 sequential regression before the Stage 16 gate.

## 3. Explicitly out of scope

- New services, inventory/stationery, promotions, loyalty, subscriptions,
  corporate accounts, reviews, chat or document editor.
- Multi-partner orders, split payment/fulfillment or new matching pipeline.
- New payment, OTP, fiscal, maps, delivery or push vendor contract.
- GPS routing, courier tracking or ETA optimization.
- Offline order creation/payment/matching or offline conflict merging.
- Storing customer documents permanently on a device.
- Mobile admin application.
- macOS/Linux studio desktop application.
- Automatic support for arbitrary printer drivers, color calibration and every
  paper tray; only a bounded provider boundary and pilot adapter are included.
- Public App Store/Google Play/Microsoft Store release, production signing and
  real push delivery without owner-supplied accounts/certificates/credentials.

## 4. Architecture and API contract

### 4.1 Preserved authority

NestJS/PostgreSQL remains authoritative. Native clients never calculate final
price, approve provider callbacks, choose an ineligible partner, advance an
order directly or create a print job locally. Existing `/api/v1` resources and
Stage 1–15 state machines remain the only domain path.

### 4.2 Proposed additive endpoints

Exact paths are finalized in OpenAPI before implementation:

| Method/path                                             | Purpose                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| `POST /api/v1/auth/native/otp/verify`                   | verify existing OTP and create native session/token family   |
| `POST /api/v1/auth/native/refresh`                      | mandatory refresh rotation and reuse detection               |
| `POST /api/v1/auth/native/logout`                       | revoke current native session                                |
| `GET /api/v1/auth/sessions`                             | safe owner session/device inventory                          |
| `DELETE /api/v1/auth/sessions/{id}`                     | revoke one owned session                                     |
| `POST /api/v1/device-installations`                     | register bounded platform installation                       |
| `PUT /api/v1/device-installations/{id}/push-endpoint`   | rotate encrypted endpoint                                    |
| `DELETE /api/v1/device-installations/{id}`              | revoke installation and push endpoint                        |
| `PUT /api/v1/uploads/{id}/chunks/{sequence}`            | idempotent bounded upload chunk                              |
| `POST /api/v1/uploads/{id}/finalize`                    | verify length/hash and enter existing quarantine pipeline    |
| `POST /api/v1/admin/branches/{id}/operators`            | invite/bind least-privilege operator                         |
| `DELETE /api/v1/admin/branches/{id}/operators/{userId}` | revoke branch operator access                                |
| `POST /api/v1/printer-agent/enroll`                     | exchange short-lived enrollment proof for machine token once |
| `POST /api/v1/printer-agent/heartbeat`                  | bounded health/capability observation, no device secrets     |

Existing order/draft/basket/payment/matching/fulfillment endpoints are reused;
there is no `/mobile/orders` or desktop state machine. All mutations continue
to require request hash/idempotency and aggregate CAS where applicable.

### 4.3 Client transport profiles

- `WebCookieTransport`: credentials include, CSRF double submit, exact Web
  origin allow-list.
- `NativeBearerTransport`: Authorization header, no cookie fallback, secure
  refresh adapter and platform installation context.
- `PrinterMachineTransport`: existing scoped agent bearer semantics, isolated
  from user session.

API guards must make the profiles mutually unambiguous. A request cannot gain
native authority merely by claiming a platform header.

## 5. Domain model and forward-only migration

Proposed additive records:

- `DeviceInstallation`: user, bounded platform (`ANDROID`, `IOS`, `WINDOWS`),
  random public installation reference, status, created/last-seen/revoked;
- `Session.clientType` and optional installation relation; existing refresh
  digest/family/reuse fields remain authoritative;
- `PushEndpoint`: installation, provider, encrypted token, token digest,
  rotation/revocation timestamps and unique active digest;
- `BranchOperatorMembership`: branch, user, status, granted/revoked evidence and
  unique active membership;
- `PrinterEnrollment`: one-time digest, branch/agent binding, expiry, attempts
  and consumed timestamp;
- upload chunk rows or equivalent immutable part manifest: session, sequence,
  length, SHA-256 and opaque object reference.

No document bytes, plaintext push token, refresh token, machine token or signed
URL enter PostgreSQL. Existing rows backfill `clientType=WEB`; nullable additive
columns preserve legacy sessions. Rollback is forward-fix once native sessions
or chunked uploads exist.

## 6. User journeys

### Customer cross-device

1. Customer starts a draft or basket on Web.
2. Customer installs Android/iOS and signs in with the same production OTP.
3. App loads active server drafts/baskets without importing browser storage.
4. Customer resumes configuration or selects a missing local file.
5. Upload survives app background/network interruption by verified chunks.
6. Existing processing, approval, quote, payment, matching and timeline proceed.
7. Switching Web/mobile or `uz/ru/en` does not mutate aggregate state.

### Studio operator on Windows

1. Partner owner/admin grants a user access to one branch.
2. An admin provisions one short-lived printer enrollment proof out of band.
3. Windows app stores resulting machine credential in Credential Manager.
4. Operator signs in separately and sees only that branch.
5. Agent claims one leased item job, downloads short-lived bytes, validates and
   spools them; retries do not duplicate a completed job.
6. Operator uses existing manual transitions through aggregate `READY`.
7. Suspension blocks new work but does not corrupt an already accepted order.

### Admin

Web Admin manages users/partners/operators, agent revocation and bounded device
status. It never receives device tokens, refresh digests, document object keys
or machine secrets.

## 7. UI/UX requirements

- Exact supported customer locales: `uz`, `ru`, `en`; equal key coverage and
  state-preserving locale switch on Web/Android/iOS.
- Native navigation, safe areas, keyboard, Android back, iOS gestures, system
  permission rationale and accessible controls.
- Clear states for offline, upload paused/resumed, expired session, CAS conflict,
  processing, payment continuation and notification deep link.
- No UUID, enum, object key, provider code or raw backend error in UI.
- Windows UI is workstation-oriented: large job status, connection/agent health,
  selected printer adapter, explicit operator confirmation and recoverable error.
- Admin remains desktop-responsive Web; no feature duplication in native apps.

## 8. Security, privacy and RBAC

- Native refresh tokens use Keychain/Keystore/Credential Manager only; access
  tokens are memory-only. App backup excludes secrets and temporary documents.
- Mobile app uses bundled local assets. Navigation to arbitrary remote content
  is blocked; external links open in the system browser.
- Capacitor/Tauri permissions are explicit and minimal. Tauri WebView has no
  generic filesystem, process, shell, credential or printer access.
- Operator membership is branch-scoped. Partner owner, operator, printer
  machine, courier, customer, admin and finance-admin authorities stay distinct.
- Device/push/enrollment mutations require ownership/RBAC, idempotency and safe
  audit; audit records only platform/action/status bounded values.
- Logs/metrics/crash reports exclude tokens, phone/address, file content/name,
  object keys, signed URLs, push endpoints, local paths and printer names.
- `no-store, private` and signed URL constraints remain on API responses. Native
  cache adapters must not persist sensitive responses.
- Root/jailbreak/integrity signals cannot replace server authorization.
- Account deletion request entry points and retention explanations are required
  before store submission; legal financial retention remains unchanged.

## 9. Idempotency, concurrency and reliability

1. Native refresh rotation remains transactional; simultaneous refresh causes
   one winner and family revocation/reuse handling according to existing policy.
2. Cross-device draft/basket changes use current version CAS. A stale client
   refetches; it never silently overwrites.
3. Chunk key is `(uploadSession, sequence, contentHash)`; identical replay is a
   no-op, different bytes conflict. Finalize is single-effect.
4. Push registration/rotation and notification dispatch are idempotent and use
   outbox/inbox; a lost push never loses the durable notification.
5. Machine enrollment is one-time, expiry/attempt bounded and transactional.
6. Printer lease heartbeat, claim and completion retain current CAS. Windows
   restart, duplicate status and network replay cannot print/create a second job.
7. Installer/app version skew is supported by additive OpenAPI changes and an
   explicit minimum-supported-client response, not undefined behavior.
8. Mobile/desktop release has staged rollout and server-side capability kill
   switches that do not rewrite domain history.

## 10. Observability and operations

- Bounded dimensions only: `client_type`, `platform`, `app_version_major`,
  route template, result code and operation type. No installation/session/job ID
  as metric label.
- Release health: auth refresh failures, upload resume outcomes, API compatibility,
  push dispatch bounded results, printer lease age and client version adoption.
- Crash reporting is opt-in/configured with payload scrubber before enablement;
  no screenshot, DOM, request body or breadcrumb URL with query.
- Runbooks cover device revoke, lost studio workstation, machine rotation,
  compromised signing key, bad app release, updater rollback and store outage.
- PostgreSQL backup gains device/session/membership/enrollment metadata; encrypted
  tokens remain ciphertext. MinIO scope and tombstones remain unchanged.

## 11. Test strategy

### Unit and contract

- API SDK matches committed OpenAPI; no hand-written contract drift.
- Complete and nonempty `uz/ru/en` keys, no inline technical customer errors.
- All platform adapters pass shared conformance suites.
- Session/token storage, deep-link allow-list, IPC scope and redaction tests.
- Resumable chunk hash/replay/order/finalize/cancel/expiry tests.

### Integration and DB-E2E

- Web cookies remain valid; native tokens cannot use CSRF/cookie downgrade.
- OTP limits plus native refresh rotation, reuse, concurrent refresh and revoke.
- Same user creates on Web and resumes/mutates on native with CAS conflicts.
- Installation/push ownership isolation and idempotent notification delivery.
- Operator membership isolation, revocation and partner/admin boundaries.
- One-time enrollment, agent lease restart and exactly-once final status effects.
- Existing file, order, payment, matching, aftercare and finance invariants.

### Platform E2E

- Web Playwright full Stage 11–15 journey in `uz/ru/en` remains green.
- Android emulator: install APK, OTP fixture, pick PDF/JPEG, interrupt/resume
  upload, resume Web draft, checkout and view timeline.
- iOS simulator: compile, launch, OTP fixture, Files/camera permission stubs,
  deep link and server resume.
- Windows clean VM: install, login, enroll synthetic agent, claim two-item order,
  spool each item once, restart mid-lease, finish READY, uninstall without
  retained secret/temp document.
- Deep links reject foreign resource and require re-auth after session expiry.

### Security and recovery

- npm/Cargo/Gradle/SPM/CocoaPods dependency gates and SBOM.
- Static native permission/capability diff; secrets scan and artifact signing
  verification.
- Logs/audit/metrics/artifacts scanned for synthetic secrets/PII/object paths.
- Clean and repeated migrations; encrypted backup and isolated restore validate
  device/session/operator lineage, token non-disclosure and all Stage 1–15 data.
- Existing RPO ≤ 24 h and RTO ≤ 4 h are measured, not assumed.

## 12. CI and release acceptance

One final SHA must prove, in order:

1. frozen install, dependency security gates, format, lint, typecheck, unit,
   integration, Prisma validate/generate and production builds;
2. clean PostgreSQL migration and repeated `migrate deploy`;
3. complete sequential Stage 1–15 regression unchanged;
4. Stage 16 API DB-E2E/security/concurrency suite;
5. Android debug APK + test AAB build and emulator acceptance;
6. iOS simulator build/test on macOS runner;
7. Windows x64 installer build and clean-VM Tauri/printer acceptance;
8. Web/Web Admin production build and `uz/ru/en` browser regression;
9. Docker PostgreSQL/Redis/MinIO/ClamAV/processing and BullMQ checks;
10. encrypted backup, isolated restore, integrity, tombstones/legal holds and
    measured RPO/RTO;
11. machine-readable `stage16-verification-report` with exact SHA, individual
    gate status and SHA-256 sidecar, uploaded with `if: always()` while any
    failed mandatory assertion still fails the job;
12. reviewable logical commits, clean tree and `main == origin/main` only after
    separately authorized integration.

## 13. Migration, deployment and rollback

1. Ship additive API/schema and dual Web/native auth support while flags are off.
2. Backfill existing sessions as `WEB`; deploy and run Stage 1–15 regression.
3. Enable native session and resumable upload for synthetic/internal users.
4. Publish Android internal APK/AAB and Windows internal installer.
5. Enable iOS simulator; add TestFlight only after external signing readiness.
6. Roll out by platform/app major with kill switches. Disabling new client
   creation does not revoke valid state or rewrite orders.
7. Database rollback is forward-fix after native rows exist. Client rollback
   must retain API compatibility and signed installer provenance.

## 14. Acceptance criteria

Stage 16 is complete only when all of the following are proven on one SHA:

- Web, Android, iOS simulator, Windows and Web Admin use one API/domain;
- a Web-created draft is resumed in Android and the same order/timeline is
  visible back on Web without local-state transfer;
- Android APK installs and passes the synthetic real-API journey;
- Windows installer passes clean VM enrollment, scoped operator access, lease,
  spool, restart and exactly-once status tests;
- iOS simulator builds and runs the contract journey; physical/TestFlight
  blocker is documented if credentials are unavailable;
- browser cookie auth and native token auth both pass rotation/reuse/revocation
  and cannot be confused;
- native secrets survive only in platform secure storage and are absent from
  backups, logs, telemetry and artifacts;
- PDF, DOCX, JPG/JPEG and PNG keep the accepted security pipeline; interrupted
  native upload resumes without duplicate permanent objects/results;
- customer UI and errors are complete in `uz`, `ru`, `en`; switching language
  does not mutate draft/order/payment/fulfillment;
- Windows operator cannot access another branch and WebView cannot access
  unrestricted filesystem/shell/credentials/printers;
- durable notification works without push credentials; mock push tests provider
  semantics without claiming production FCM/APNs readiness;
- all Stage 1–15 behavior and gates remain green;
- backup/restore, RPO/RTO, verification artifact and repository-state gates pass.

## 15. External blockers and dependencies

Implemented boundaries can be verified with synthetic adapters, but these
commercial-release items require owner/external action:

- Apple Developer organization membership, macOS/Xcode fleet, certificates,
  provisioning and App Store Connect access;
- Google Play organization account, signing ownership, Play Console verification
  and store review;
- Windows organization code-signing certificate and protected signing service;
- real FCM/APNs projects and credentials;
- contracted production OTP, acquiring, fiscal, payout, maps/delivery providers
  already identified by earlier stages;
- legal privacy/retention/account-deletion texts for Uzbekistan and store forms;
- physical Android/iPhone device matrix and certified Windows printer/driver
  matrix in pilot studios;
- real off-host production backup/secret store and an operational support team.

No credentials, legal declarations or successful physical-printer certification
may be invented or inferred from CI.

## 16. Risks

| Risk                                        | Severity | Mitigation                                                                    |
| ------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| Two auth transports create downgrade path   | Critical | mutually exclusive guards, token-family tests, security review                |
| Native plugin/IPC compromise                | Critical | minimal plugins, scoped capabilities, SBOM and remote navigation block        |
| Cross-device lost update                    | High     | existing aggregate CAS, refetch/merge UX, race DB-E2E                         |
| Interrupted mobile upload duplicates object | High     | part hashes, finalize CAS, outbox/inbox and cleanup                           |
| Studio workstation exposes documents        | High     | machine/user separation, encrypted credential store, private temp and cleanup |
| Thin WebView rejected by Apple              | High     | bundled app-like native capabilities and pre-submission review                |
| Printer driver variability                  | High     | provider port, virtual/spool pilot, explicit certified matrix                 |
| i18n divergence among clients               | Medium   | one catalog, no inline copy, compile-time/test enforcement                    |
| Version skew                                | Medium   | additive API, compatibility matrix and minimum-supported policy               |
| CI cost/time grows sharply                  | Medium   | sequential acceptance plus scoped PR jobs; never drop final full gate         |

## 17. Roadmap from Stage 16 to launch

This is a release roadmap, not authorization for later feature stages:

- **Internal platform alpha:** all Stage 16 synthetic acceptance, threat review,
  test APK/Windows installer and iOS simulator.
- **Studio/device pilot:** a small Tashkent studio group, physical printers and
  Android/iPhone test devices; observe reliability without customer PII in
  telemetry.
- **Closed store beta:** Google internal/closed testing and TestFlight after
  accounts, legal texts, signing and production push readiness.
- **Production readiness review:** contracted OTP/acquiring/fiscal providers,
  external penetration test, load/chaos exercise, off-host restore, incident
  ownership and store declarations.
- **Staged commercial launch:** percentage rollout, compatibility/kill switches,
  support SLO and daily finance/fulfillment reconciliation.

## 18. Decomposed delivery plan

The estimates below are planning ranges, not deadlines or guarantees. They
assume one senior full-stack engineer, part-time native/security/QA support,
working CI and prompt access to the listed external resources. Calendar time
can be shortened with parallel specialists, but the final sequential regression
cannot be parallelized away.

Each substage has its own reviewable commit set, targeted verification and a
demonstration checkpoint. A substage is not accepted merely because its UI
renders. Its stated tests and security conditions must also pass.

### Stage 16.1 — Contract freeze, shared presentation foundation and Web preview

**Result**

- Freeze the platform ADR, OpenAPI compatibility rules and client support
  matrix before schema or native work.
- Extract the first `packages/api-client`, `packages/i18n` and shared visual
  tokens/components without changing Web behavior.
- Inventory all customer-visible strings and enforce complete, nonempty
  `uz/ru/en` keys. Existing inline RU/UZ strings become tracked migration work.
- Add a synthetic-data component/flow preview for customer Web, mobile viewport
  and studio workstation layouts. Preview adapters cannot call production
  mutations or contain real credentials.
- Produce a `stage16-ui-preview` CI artifact and a documented preview URL when
  an approved preview host is available.

**Acceptance**

- Existing Web/Web Admin production builds and applicable Stage 1–15 Web tests
  remain green.
- OpenAPI drift and locale completeness tests fail on a missing contract/key.
- Customer Web preview is usable at desktop and 390 px mobile width.
- Preview shows `uz`, `ru` and `en`; locale switching changes presentation only.
- No internal IDs, raw enums, secrets or personal data exist in fixtures.

**Dependencies:** accepted proposal; no store account or native toolchain.
**Estimate:** 4–7 person-days; roughly 3–6 working days.
**First owner-visible checkpoint:** the owner can open the Web customer preview
and inspect the proposed Android/Windows layouts in a browser at the end of
16.1.

### Stage 16.2 — Capacitor mobile shell and installable visual Android preview

**Result**

- Create `apps/mobile` with React/Vite and Capacitor Android/iOS projects.
- Implement navigation, safe areas, platform lifecycle, theme and complete
  trilingual visual states against deterministic synthetic read-only fixtures.
- Add camera/files/secure-storage/deep-link interfaces with non-privileged
  preview adapters; no fake production success path.
- Build a reproducible Android debug APK and an iOS simulator-compilable shell.

**Acceptance**

- Android APK installs on a clean emulator and one supported physical device.
- Main screens render in `uz/ru/en`, survive rotation/background/foreground and
  meet baseline keyboard/screen-reader navigation checks.
- Remote arbitrary navigation, cleartext traffic and undeclared permissions are
  rejected.
- The APK is labelled **visual preview**: it is not yet evidence of real auth,
  upload, payment or store readiness.

**Dependencies:** 16.1; Android SDK/Java in CI; macOS runner for iOS compile.
**Estimate:** 7–11 person-days; roughly 1–2 weeks.
**Demonstration checkpoint:** first APK the owner can install. It is an
interactive visual preview, not yet the working end-to-end pilot APK.

### Stage 16.3 — Tauri Windows shell and installable studio preview

**Result**

- Create `apps/studio-desktop` with Tauri 2 and React.
- Implement the trilingual studio/operator navigation, job queue, connection,
  machine and print-state screens using synthetic read-only fixtures.
- Define least-privilege Tauri capabilities, navigation/CSP rules and typed IPC
  skeleton. Generic shell/filesystem/process access is absent.
- Produce an internal x64 MSI/NSIS or supported Tauri installer and portable
  diagnostic build.

**Acceptance**

- Clean Windows 10 and Windows 11 VMs install, launch, close and uninstall the
  application.
- The preview cannot access arbitrary paths, credentials, printers or network
  origins through the WebView.
- `uz/ru/en` UI and scale factors 100/125/150% render without clipped critical
  controls.
- Installer is explicitly marked internal/unsigned until a signing certificate
  exists; it is not proof of printer compatibility.

**Dependencies:** 16.1; Rust/Tauri/WebView2 Windows builder.
**Estimate:** 7–12 person-days; roughly 1–2 weeks.
**Demonstration checkpoint:** first Windows program the owner can install and
inspect. It has no authority to print or change real order state yet.

### Stage 16.4 — Native identity, device lifecycle and cross-device resume

**Result**

- Add the forward-only session/device migration and mutually exclusive Web,
  native-user and printer-machine transports.
- Implement OTP-based native login, rotating refresh, reuse detection, secure
  storage adapters, installation revoke and safe session inventory.
- Connect mobile shell to the real API for catalog, drafts, baskets, orders,
  timeline and durable in-app notifications.
- Prove Web-created state resumes on mobile and mobile changes appear on Web.

**Acceptance**

- Web cookie/CSRF behavior remains compatible and passes its regression.
- Native token is never stored in JavaScript storage, logs, audit, metrics,
  backup output or screenshots.
- Concurrent refresh, stolen-token replay, revoke, foreign installation and
  Web/native downgrade tests fail closed.
- Cross-device CAS conflict returns a localized recovery path instead of
  overwriting state.
- Clean and repeated migrations plus targeted identity/order DB-E2E pass.

**Dependencies:** 16.1–16.2; PostgreSQL; production OTP remains externally
configured and CI uses the accepted test provider only.
**Estimate:** 10–16 person-days; roughly 1.5–3 weeks.

### Stage 16.5 — Native file/camera bridge, resumable upload and functional APK

**Result**

- Implement native file/photo selection and camera capture with just-in-time
  permissions and private temporary storage.
- Implement checksum-based resumable upload while preserving the existing
  single-PUT Web route and the complete Stage 3 quarantine/AV/processing path.
- Complete the Android real-API customer path from login through processing,
  approval, basket/quote/checkout/payment continuation and timeline.
- Remove temporary captures after acknowledgement/cancel/expiry and prevent
  sensitive app backup.

**Acceptance**

- PDF, DOCX, JPG/JPEG and PNG pass the actual API pipeline from Android.
- Network interruption, app backgrounding and process restart resume upload
  without duplicate object/result; changed chunk replay conflicts.
- File-size/page/pixel/quota/MIME/signature/AV/DOCX protections remain green.
- Camera/file permissions are minimal; filename, local path and EXIF location
  do not leak.
- Android emulator and physical-device journey pass in `uz/ru/en`.

**Dependencies:** 16.2 and 16.4; Stage 3 services in CI; Android test device.
**Estimate:** 12–20 person-days; roughly 2–3.5 weeks.
**Demonstration checkpoint:** first **working test APK**. The owner can use a
synthetic environment to start/resume a real server-side order. This is still
not a signed Google Play release.

### Stage 16.6 — iOS lifecycle, deep links and notification boundary

**Result**

- Complete iOS Files/camera/Keychain/lifecycle adapters and Universal Links;
  add Android App Links using the same HTTPS routes.
- Add device/push schema and provider-neutral outbox/inbox dispatch. Durable
  in-app notifications remain complete without FCM/APNs.
- Run the customer contract on iOS simulator and prepare a physical-device and
  TestFlight checklist.

**Acceptance**

- iOS simulator builds and passes auth/resume/navigation/lifecycle tests on a
  macOS runner.
- Deep links are allow-listed, recheck ownership after login and reject foreign
  resources.
- Duplicate/rotated/revoked push endpoints are idempotent; payload contains no
  customer/order/file/payment details.
- Real FCM/APNs delivery is reported externally blocked unless credentials are
  supplied; no fake production success is claimed.

**Dependencies:** 16.4–16.5; macOS runner. Physical/TestFlight verification
requires Apple membership, devices and signing.
**Estimate:** 8–14 person-days; roughly 1.5–2.5 weeks, excluding Apple review.

### Stage 16.7 — Windows operator authority, machine enrollment and virtual print

**Result**

- Add branch-scoped operator membership and RBAC without widening partner/admin
  authority.
- Implement one-time printer-machine enrollment and Credential Manager storage.
- Reuse the existing printer-agent claim/lease/status protocol in Tauri native
  core; retain the headless agent as fallback.
- Implement only the deterministic virtual/spool-directory adapter for automated
  acceptance. It validates PDF/hash/size, writes atomically and cleans temp data.

**Acceptance**

- Foreign branch/operator/job access fails without enumeration.
- Enrollment is one-use, attempt/TTL bounded and revocable; WebView cannot read
  the resulting credential.
- Duplicate claim/status, restart mid-lease and network replay do not create a
  second job, second output or invalid order transition.
- A synthetic multi-item job writes exactly one validated file per item to an
  isolated virtual spool directory and reaches the existing aggregate barrier.
- No assertion or report calls this result compatible with a physical printer.

**Dependencies:** 16.3–16.4; Windows VM and API/Redis/PostgreSQL.
**Estimate:** 12–20 person-days; roughly 2–3.5 weeks.
**Demonstration checkpoint:** first **working Windows pilot application** for
real API/operator workflow and virtual printing.

### Stage 16.8 — Physical printer qualification (separate evidence track)

This substage is deliberately separate from 16.7. A successful virtual spool
test proves only software protocol, download validation, leasing and local file
handoff. It proves nothing about a Windows driver, printer language, tray,
duplex, color profile, paper size or physical output.

**Result when hardware is supplied**

- Select an explicit pilot matrix: manufacturer/model, Windows version, driver
  version, connection type and supported paper/color/duplex capabilities.
- Add or configure a bounded Windows Print Spooler adapter; no arbitrary shell
  command or vendor executable from WebView.
- Print only synthetic calibration documents and record result per exact model.
- Publish a compatibility matrix with `SUPPORTED`, `LIMITED`, `FAILED` or
  `UNVERIFIED`; never generalize one model's result to a family without proof.

**Acceptance for each supported model**

- Clean-machine driver install and signed desktop application setup are
  repeatable.
- Correct printer selection, page count, paper size/orientation, color mode,
  scale, duplex/tray where claimed, cancellation, offline/reconnect and Windows
  restart are physically observed.
- One API job produces no more than one accepted print action under retries;
  uncertain spool outcome enters manual review rather than automatic reprint.
- Temporary files and credentials are removed according to policy; no customer
  document is used in qualification.

**Dependencies:** 16.7; owner-provided physical hardware, current vendor drivers,
Windows test workstation and an on-site operator.
**Estimate:** 3–6 person-days for harness/preparation plus 1–3 person-days per
printer/driver/connection combination; scheduling and driver defects can extend
calendar time materially.

**Completion semantics:** Stage 16 software foundation may be accepted with
16.8 recorded as externally blocked/unverified, but the product must not claim
physical-printer compatibility or start a studio hardware rollout. Commercial
printing on a named model requires that model's 16.8 result to be `SUPPORTED`.

### Stage 16.9 — Final hardening, recovery and one-SHA acceptance

**Result**

- Finish OpenAPI, ERD, ADR, RBAC, threat model, privacy/store, signing/update,
  deployment, support and recovery documentation.
- Add npm/Cargo/Gradle/iOS dependency security gates, SBOM and provenance.
- Run the entire final acceptance chain on one immutable SHA and publish the
  `stage16-verification-report` plus checksums.

**Acceptance**

- Frozen install, format, lint, typecheck, unit/integration, Prisma
  generate/validate, all production builds and security audits succeed.
- Clean and repeated migrations succeed.
- Sequential Stage 1–15 regression remains completely green and unchanged.
- Stage 16 DB-E2E, Android E2E, iOS simulator and Windows VM/virtual-spool gates
  succeed without retries masking first-attempt acceptance failures.
- Docker PostgreSQL/Redis/MinIO/ClamAV/processing/BullMQ, encrypted backup,
  isolated restore, tombstones/legal holds and measured RPO/RTO succeed.
- Artifact belongs to the exact final SHA; repository is clean and synchronized.
- 16.8 physical results are reported separately and cannot be inferred from the
  green virtual-spool gate.

**Dependencies:** 16.1–16.7; 16.8 evidence when hardware is available.
**Estimate:** 8–14 person-days; roughly 1.5–2.5 weeks, plus root-cause fixes
found by the final regression.

## 19. Demonstration checkpoints

| Milestone   | First thing the owner can do                                                           | What it does **not** prove                         |
| ----------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| End of 16.1 | Open Web customer preview and browser-sized mobile/desktop layouts                     | Native runtime, real auth or store readiness       |
| End of 16.2 | Install Android visual-preview APK and inspect `uz/ru/en` UI                           | Real upload/payment/order completion               |
| End of 16.3 | Install Windows visual-preview program                                                 | Operator RBAC, machine enrollment or printing      |
| End of 16.4 | Start in Web and resume server draft/order in mobile                                   | Native file/camera upload                          |
| End of 16.5 | Install functional Android APK and complete synthetic real-API customer path           | Google Play approval/signing                       |
| End of 16.6 | Review iOS simulator flow; optionally install TestFlight build if signing is available | App Store approval                                 |
| End of 16.7 | Install functional Windows pilot and process a synthetic job into virtual spool        | Compatibility with any physical printer            |
| End of 16.8 | Print synthetic calibration job on explicitly named hardware                           | Compatibility with untested models/drivers         |
| End of 16.9 | Review one-SHA CI evidence and all installable artifacts                               | External contracts or store approvals not supplied |

## 20. Owner instructions on Windows

These are the intended no-coding procedures the implementation must provide.
Exact artifact names may gain a version suffix, but the workflow is contractual.

### 20.1 Open the Web preview

Preferred hosted route:

1. Open the Stage 16 GitHub Actions run supplied in the checkpoint report.
2. Open the `stage16-ui-preview` deployment link.
3. Select `UZ`, `RU` and `EN` and inspect the customer, mobile viewport and
   studio workstation scenarios.
4. Use only the synthetic demo account displayed in the preview instructions;
   never enter a real phone, address or customer file.

Local fallback when no preview host is approved:

1. Download the `stage16-web-preview-windows` artifact and its `.sha256` file
   from GitHub Actions.
2. In PowerShell run
   `Get-FileHash .\stage16-web-preview-windows.zip -Algorithm SHA256` and compare
   it with the published checksum.
3. Extract the archive and double-click `Start-AGAT-Web-Preview.cmd`.
4. The page opens on local-only `127.0.0.1`; the package requires no Docker,
   source editing, `.env`, account or credentials.
5. Return to the launcher window and press `Ctrl+C` after review. It creates no
   containers, services, customer files or persistent application data.

### 20.2 Install the Android APK from Windows

1. Download `agat-mobile-android-debug.apk` and its checksum from the exact
   checkpoint CI run. A debug APK is internal testing software, not Play release.
2. Verify the SHA-256 with `Get-FileHash` as above.
3. On the Android phone temporarily allow installation of unknown apps for the
   file-transfer/browser application being used.
4. Copy the APK by USB or download it directly, tap the file and approve the
   installation. Revoke the unknown-app permission immediately afterwards.
5. Alternatively install Android Platform Tools and run
   `adb install -r .\agat-mobile-android-debug.apk` with USB debugging enabled.
6. Open AGAT PRINT, choose the documented synthetic environment, sign in with
   the supplied test-only fixture and perform the checkpoint scenario.
7. Grant camera/files/notifications only when the relevant action asks. Denying
   an optional permission must leave a comprehensible fallback.
8. Do not upload personal documents. After review, sign out, revoke the test
   installation in the app and uninstall it from Android settings.

The production Play path later uses an AAB, Play App Signing and a verified
store listing; sideloaded debug APK success is not equivalent.

### 20.3 Install the Windows studio program

1. Download `agat-studio-windows-x64.msi` (or the documented Tauri installer)
   and `.sha256` from the exact checkpoint run.
2. Verify SHA-256. For a production-signed build also open file Properties →
   Digital Signatures and confirm the expected AGAT PRINT publisher.
3. Use a disposable Windows 10/11 test workstation or VM. Internal unsigned
   previews may show SmartScreen; never interpret bypassing that warning as a
   production deployment procedure.
4. Run the installer, open AGAT PRINT Studio and select **Test virtual spool**.
5. Sign in with the synthetic operator account and enter the one-time synthetic
   enrollment code through the app. Do not put tokens into command-line options.
6. Process the supplied synthetic job. Open the app's bounded test-spool view
   and confirm one output per item. Do not manually copy files into the spool.
7. Restart the app during the documented recovery scenario and confirm it does
   not duplicate the completed job.
8. Sign out, revoke the test machine, uninstall the application and use the
   verification screen to confirm temporary job files/credentials are gone.

### 20.4 Later physical-printer check

Physical mode stays disabled until Stage 16.8 begins for a named device. The
owner/operator then:

1. records exact printer model, serial-free inventory alias, Windows and driver
   versions, USB/network connection and supported paper features;
2. installs the vendor driver from its verified official source;
3. selects that exact printer in the restricted native settings screen;
4. prints the synthetic calibration PDF for simplex, and only claimed duplex,
   tray, paper-size and color combinations;
5. physically compares page count, orientation, scale, margins, color and
   cancellation/reconnect results with the checklist;
6. signs the compatibility record. A failure remains `FAILED`/`LIMITED`; it is
   not hidden by switching back to virtual spool.

No customer file is permitted in hardware qualification. Until a model passes,
the UI and documentation must label it `UNVERIFIED`.

## 21. Aggregate effort and schedule range

| Substage                            |               Person-days | Indicative elapsed time | Main uncertainty                                       |
| ----------------------------------- | ------------------------: | ----------------------- | ------------------------------------------------------ |
| 16.1 contracts/shared preview       |                       4–7 | 3–6 working days        | amount of existing inline UI/i18n extraction           |
| 16.2 Capacitor visual shell         |                      7–11 | 1–2 weeks               | native build toolchain and device layout differences   |
| 16.3 Tauri visual shell             |                      7–12 | 1–2 weeks               | installer/WebView2/toolchain behavior                  |
| 16.4 native identity/resume         |                     10–16 | 1.5–3 weeks             | auth threat review and concurrent session behavior     |
| 16.5 upload/functional Android      |                     12–20 | 2–3.5 weeks             | URI streaming, backgrounding and processing regression |
| 16.6 iOS/deep links/push boundary   |                      8–14 | 1.5–2.5 weeks           | macOS/signing/device access                            |
| 16.7 Windows operator/virtual print |                     12–20 | 2–3.5 weeks             | secure enrollment, Tauri IPC and lease recovery        |
| 16.8 physical qualification         | 3–6 + 1–3 per combination | hardware-dependent      | device/driver availability and physical output         |
| 16.9 full hardening/acceptance      |                      8–14 | 1.5–2.5 weeks           | regressions and external CI stability                  |

Software scope 16.1–16.7 plus 16.9 is approximately **68–114 person-days**.
With one primary engineer this is roughly **14–23 working weeks**; with two
appropriately skilled engineers and part-time QA/security it may be roughly
**8–14 calendar weeks**. These ranges exclude store review, procurement,
contracting, waiting for signing credentials and unplanned remediation. They
must be re-estimated after 16.1 and again after the first native toolchain builds.

## 22. Approval and change control

Approval of this proposal authorizes none of the following until the owner gives
a separate implementation instruction: schema changes, functional code, native
projects, signing setup, pull requests or merge.

After implementation authorization, each substage must end with:

1. a short evidence report tied to an exact commit SHA;
2. targeted quality/security/regression results;
3. the named preview/install artifact where applicable;
4. disclosed failures and external blockers, never a forced-green result;
5. no scope from a later substage silently pulled forward except a prerequisite
   explicitly documented in the same commit.

The complete Stage 1–15 regression is mandatory on the final Stage 16 SHA and
after any change to shared auth, upload, order, payment, matching, fulfillment,
printer or recovery code. Scoped checks may be used for intermediate commits,
but cannot replace that final sequential evidence.

Implementation, migrations, native projects, commits and pull requests require
the user's separate explicit approval after this updated proposal review.
