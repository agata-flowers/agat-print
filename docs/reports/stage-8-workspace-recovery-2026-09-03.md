# Stage 8 workspace recovery

Accepted Stage 7 baseline: c2865205180b9db913de97d3abcab8a8262440bb,
GitHub Actions run 33517487126. This is a recovery/progress record, not a
Stage 8 completion report.

The workspace initially had stale Git metadata (HEAD
2afb37b67841b08db9e1d8ddf58d657164b6d261), no index and no remote. The public
canonical remote was verified as https://github.com/agata-flowers/agat-print.
Baseline comparison found 174 matching tracked file blobs, no modified or
extra files, and two missing empty root assets. Only those empty assets were
restored. The prior HEAD was preserved in recovery/pre-stage8-stale-metadata.
The canonical objects were fetched, main metadata and a standard index were
rebuilt against the accepted commit, and upstream was set to origin/main.
The resulting baseline diff/status were clean. No reset, repository reclone,
recursive deletion or overwrite of local Stage 8 work was performed.

Subsequent Stage 8 code, migration, UI and test edits remain in this same
working tree. They must be preserved on resume after any API/session failure.
No Stage 8 commit or push has been made; the next stage has not started.

The available Windows workspace has the bundled Node/pnpm runtime but no
Docker daemon, PostgreSQL, Redis or MinIO test services. Local static/unit/build
checks cannot establish DB-E2E, migration, sandbox or recovery correctness.
Infrastructure results, actual RPO/RTO, GitHub run and artifact digest must
remain unreported until a Docker-capable environment has executed the gates.

## Local verification at this checkpoint

- pnpm install --frozen-lockfile: passed with the existing lockfile.
- pnpm ci (pnpm clean-install alias): recreated workspace node_modules from
  the lockfile; completed successfully. No dependency version changes.
- pnpm db:generate and pnpm db:validate: passed.
- pnpm run ci: passed format check, lint, typecheck, unit tests and production
  builds for the final code/UI tree. 34 API, 9 web and 2 printer-agent tests
  passed; database suites were not enabled and are not counted as verified.
- Bash syntax checks for backup.sh, restore.sh and stage8.sh: passed using
  bundled GNU Bash. No infrastructure behavior is implied by syntax checks.
- Stage 8 infrastructure script: exit 127 at compose-build-health because
  Docker is absent. The diagnostic JSON was created with result=failure and
  null RPO/RTO, preserving the failure status.
- git diff --check: passed. Work remains intentionally uncommitted.

## Resume requirements

Use the same working tree and standard Git index; do not reset to Stage 7.
Provide a Docker-capable test host or enable Docker for this workspace before
the migration and integration verification. Do not claim acceptance based on
the static/unit gate. Run all Stage 2–7 regressions and Stage 8 DB-E2E, inspect
actual queue redelivery/lease recovery and cumulative-refund concurrency, and
verify old-backup/newer-tombstone-ledger restoration. Review retention quota
release and shared-artifact retention under concurrent holds before release.
Any newly exposed failures require fixes and repeated gates, not weakened
checks. Commit/push and GitHub Actions verification remain pending the required
local success. No next-stage implementation is authorized.

## Infrastructure verification handoff to GitHub Actions

The user accepted the local result as intermediate and explicitly authorized
committing/pushing this preserved working tree after the non-Docker gate.
GitHub Actions is now the canonical environment for all mandatory Docker/DB
checks. The absent local Docker executable is an environment limitation, not
a successful infrastructure check and not evidence of a domain-code defect.
The workflow retains Stage 2–7 regressions, adds Stage 8 DB-E2E and a recovery
drill with a newer deletion ledger, and always uploads the diagnostic report.
Acceptance still requires both jobs, DB regressions, restore integrity and
measured RPO/RTO to pass. This note does not assert that CI has passed.
