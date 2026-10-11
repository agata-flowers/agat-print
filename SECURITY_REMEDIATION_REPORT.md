# AGAT PRINT Security Remediation Report

Status: implementation in progress  
Baseline date: 2026-10-11  
Baseline branch: `codex/security-remediation-stage15`  
Baseline SHA: `89637db22fc7e1aca947eac8693a26e10344a6cb`

## Baseline

The accepted Stage 1–15 baseline passed GitHub Actions run
[`38128026560`](https://github.com/agata-flowers/agat-print/actions/runs/38128026560),
but `pnpm audit --prod` found 43 advisories: 2 critical, 20 high, 19 moderate,
and 2 low. The original dependency versions and planned dispositions are
recorded below before changing the lockfile.

| Package                | Baseline | Findings | Highest severity | Planned disposition                                          |
| ---------------------- | -------- | -------: | ---------------- | ------------------------------------------------------------ |
| `next`                 | 16.3.3   |        7 | critical         | Patch to 16.3.8 and rebuild/test the complete PWA            |
| `proxy-addr`           | 2.0.7    |        1 | critical         | Resolve 2.0.8 through the patched Express tree               |
| `deepmerge-ts`         | 7.1.5    |        1 | high             | Validate a scoped 8.0.0 resolution for Prisma config         |
| `effect`               | 3.16.12  |        1 | high             | Upgrade Prisma 6.x so config resolves a patched Effect       |
| `image-size`           | 2.0.2    |        2 | high             | Patch to 2.0.4 and add malformed-image regression            |
| `js-yaml`              | 4.1.0    |        5 | high             | Upgrade Swagger 11.x to its patched dependency tree          |
| `lodash`               | 4.17.21  |        3 | high             | Upgrade Swagger 11.x to its patched dependency tree          |
| `multer`               | 2.0.2    |        8 | high             | Resolve 2.3.0 with Nest boot/upload compatibility tests      |
| `path-to-regexp`       | 8.2.0    |        2 | high             | Upgrade Nest 11.x to the patched routing dependency          |
| `playwright`           | 1.55.0   |        1 | high             | Patch to 1.55.1 and require zero acceptance retries          |
| `sharp`                | 0.35.3   |        2 | high             | Resolve at least 0.35.5 through the patched Next tree        |
| `source-map-js`        | 1.2.1    |        1 | high             | Resolve 1.2.2 through the patched Next/PostCSS tree          |
| `@nestjs/core`         | 11.1.6   |        1 | moderate         | Patch the aligned Nest 11 packages                           |
| `decode-uri-component` | 0.2.2    |        1 | moderate         | Evaluate a MinIO-compatible patched resolution               |
| `file-type`            | 21.0.0   |        2 | moderate         | Patch through `@nestjs/common`                               |
| `qs`                   | 6.15.3   |        2 | moderate         | Resolve at least 6.16.0 through Express                      |
| `stream-json`          | 1.9.1    |        3 | moderate         | Test upstream-incompatible major safely; document if blocked |

The complete per-advisory disposition, final versions, verification evidence,
residual risks, commit SHAs, and GitHub Actions run will be added after the
implementation is verified. No Stage 16 work is included.
