# AGAT PRINT — infrastructure verification for stage 2

Date: 2026-08-27  
Branch: `main`  
Final stage 2 commit: `db1939ea5c9a2f72ac20ff4223104bb0e0486639`

## Outcome

Stage 2 passed the local quality gate and the complete isolated infrastructure
verification in GitHub Actions. Stage 3 was not started during this work.

The delivered foundation includes persistent MinIO references and retention
tombstones, their Prisma migration, a filtered manifest of persistent objects,
a consistent PostgreSQL dump, encrypted restic backup to a separate
S3-compatible endpoint, isolated PostgreSQL and MinIO restoration, and
mandatory tombstone replay before API enablement. Production secret validation
was strengthened, the ERD and operational documentation were updated, and the
format check was repaired.

## Verification results

| Check                                                      | Result                      |
| ---------------------------------------------------------- | --------------------------- |
| Frozen dependency installation                             | Passed                      |
| Format, lint, typecheck, tests and production build        | Passed                      |
| Fresh checkout, standard Git index and clean status        | Passed                      |
| Docker Compose configuration, build, startup and health    | Passed                      |
| API, web, backup and restore images                        | Built                       |
| Migrations on a clean PostgreSQL database                  | Two migrations applied      |
| Repeated migration deployment                              | No pending migrations       |
| Database E2E suite                                         | 5 files and 16 tests passed |
| Production rejection of mock OTP and unsafe secrets        | Passed                      |
| Consistent custom-format PostgreSQL dump                   | Passed                      |
| Persistent-object manifest filtering                       | Passed                      |
| Encrypted restic backup to separate S3-compatible service  | Passed                      |
| Source deletion and isolated PostgreSQL/MinIO restore      | Passed                      |
| Mandatory retention tombstone replay                       | Passed                      |
| Restored database, manifest and object checksum validation | Passed                      |
| Sensitive object identifiers absent from the final CI log  | Passed                      |

## Measured recovery objectives

The small synthetic CI dataset produced:

- RPO: **7 seconds**
- RTO: **2 seconds**

Both are within the pilot objectives of RPO at most 24 hours and RTO at most
4 hours. These measurements describe the synthetic verification dataset and
must not be treated as production capacity estimates.

## GitHub Actions evidence

- Workflow run: `33093791599` — successful
- Quality job: `98593290428` — successful
- Infrastructure job: `98594025508` — successful
- Verification artifact: `9655646225`
- Artifact SHA-256:
  `5aa3d8bbe5b8293612fd60dfe6903395de748a5978d58845c2a169a194603164`

## Known limitations

- CI represents the off-host topology with a separate S3-compatible service on
  an ephemeral runner. Production requires a physically external endpoint and
  an external secret store.
- RPO and RTO must be measured again with production-like data volumes. The
  monthly isolated restore drill remains an operational requirement.
- The local Windows task environment did not expose Docker and did not permit
  writing the repository metadata. Docker and standard-index checks therefore
  ran in a fresh GitHub-hosted checkout.
- A real OTP provider is not connected in stage 2. The provider interface is
  present and production configuration rejects the mock provider.
- Uploads, conversion, OCR/CV, preflight, orders, payment, dispatch, production
  and delivery were outside stage 2 and were not implemented.
