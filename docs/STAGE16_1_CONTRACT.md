# Stage 16.1 — shared presentation and visual preview contract

## Boundary

Stage 16.1 is presentation-only. It adds no schema, API endpoint, native shell,
authentication mode or domain transition. NestJS/PostgreSQL and all Stage 1–15
state machines remain authoritative. The preview uses deterministic synthetic
objects and contains no production transport.

The shared foundation consists of:

- `@agat/api-client`: injected transport, bounded safe errors and typed JSON
  reads; it does not choose credentials or store tokens;
- `@agat/i18n`: the mandatory and exhaustive `uz`, `ru`, `en` locale contract;
- `@agat/ui`: brand metadata and reusable CSS design tokens;
- `@agat/platform-preview`: browser demonstration of customer Web, mobile
  viewport and studio workstation directions.

## Compatibility rules

1. Existing `/api/v1` resources, request bodies, cookies, CSRF and RBAC remain
   unchanged. Future native profiles are additive and require a separately
   approved stage.
2. Shared clients consume checked-in OpenAPI contracts. Removing or changing a
   released field/path requires an explicit compatibility decision, migration
   window and regression evidence; generating a second domain API is forbidden.
3. Customer-visible copy is keyed presentation data. Domain enums, provider
   codes and raw errors are never rendered directly.
4. A locale change only changes presentation; it cannot issue mutations or
   change draft, order, payment, pricing or fulfillment state.
5. Preview fixtures must contain no personal data, UUIDs, object keys, signed
   URLs, secrets or real documents. Network mutations are forbidden.

## Supported client matrix at this checkpoint

| Surface                  | Stage 16.1 evidence                            | Production authority                 |
| ------------------------ | ---------------------------------------------- | ------------------------------------ |
| Customer Web             | Interactive desktop browser preview            | Existing Next.js Web                 |
| Android/iOS direction    | 390 px browser phone frame only                | Not implemented                      |
| Windows studio direction | Browser workstation preview; controls disabled | Existing headless printer-agent only |
| Web Admin                | Existing Stage 1–15 UI remains unchanged       | Existing Next.js Web                 |

The mobile and studio previews are not installable applications and are not
evidence of camera, secure storage, WebView lifecycle, printer or driver
compatibility. Those belong to later approved substages.

## Verification

- exhaustive, nonempty locale keys for exactly `uz`, `ru`, `en`;
- unit tests for safe API errors and URL-bounded preview state;
- existing Web tests/typecheck/build after shared package adoption;
- browser E2E at desktop and 390 px widths, with zero retries;
- no non-GET request while the synthetic checkout path is demonstrated;
- an exact reviewed OpenAPI SHA-256 baseline that makes later drift explicit;
- CI artifact checksum and machine-readable verification report.
