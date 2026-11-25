# Testing and Release Requirements

**Status:** Stage 2F approved  
**Applies to:** Phase 3 implementation and all future production releases  
**Branch:** `phase-3-core-api-mysql`

This document defines the quality gates required before Overland Core can be merged, migrated, or released. It records the current baseline separately from the target requirements. A feature being implemented or having a database table does not mean it has passed these gates.

## 1. Release principles

1. **Protect production data.** Automated tests must use isolated test resources. CI must never connect to CoalByte production.
2. **No destructive migration by default.** Schema changes are additive unless a separately reviewed migration plan explicitly authorizes a destructive change.
3. **Test the real architecture.** Bot and dashboard business-data operations must be exercised through the Core API and normalized MySQL repositories.
4. **Permissions are part of correctness.** Every staff operation must test both an authorized actor and an unauthorized actor.
5. **Preserve existing behavior.** Existing commands, ticket flows, rewards, and dashboard capabilities must retain parity unless a deliberate product change is approved.
6. **Release in reversible steps.** Keep the JSON compatibility path and current production behavior available until MySQL parity and reconciliation are proven.
7. **Approval is explicit.** Passing CI does not authorize a production migration, a production storage switch, a merge, or a deployment.

## 2. Current baseline

### Existing automated checks

The current root CI workflow runs:

- Dependency installation.
- Prisma client generation and Prisma schema validation.
- Dashboard TypeScript typecheck.
- Bot automated tests.
- Bot and dashboard production build.

The bot test script uses Node's built-in test runner. The current automated test baseline includes five tests covering:

- Member lookup.
- Internal staff permission checks.
- Public role restrictions.
- Economy idempotency and daily limits.
- Reward rejection and refund behavior.

The bot check script also performs lightweight source/syntax validation.

### Known coverage gaps

The current checks do not yet provide a complete release gate for:

- Disposable MySQL integration tests.
- Applying every SQL migration to a clean MySQL instance.
- Migration retry and partially-applied migration recovery.
- Importer parity and row-count reconciliation.
- Core API route authorization and validation across every domain.
- End-to-end Discord interactions for setup, verification, tickets, moderation, roles, and economy.
- Dashboard browser workflows and API-to-MySQL consistency.
- Cross-surface consistency between Discord actions and dashboard views.
- Production backup restoration and rollback rehearsal.

A green current CI run therefore means the existing checks passed. It does not prove production readiness or MySQL cutover readiness.

## 3. Required test layers

### 3.1 Unit tests

Use unit tests for deterministic logic that does not require Discord, HTTP, or a database.

Required coverage:

- Input parsing, validation, and normalization.
- Permission mapping and role hierarchy rules.
- Economy amount, currency, limit, and balance validation.
- Idempotency-key generation and duplicate-operation handling.
- Ticket and reward state-transition rules.
- Verification eligibility and configured requirements.
- Setup configuration validation and defaults.
- Pagination, filtering, and response-shape mapping.
- Error mapping from repository/API layers to user-safe responses.

Unit tests must include normal cases, invalid inputs, boundary values, and unauthorized cases where applicable.

### 3.2 MySQL integration tests

Run against a disposable MySQL database using the same major MySQL version and relevant SQL behavior as the hosted database. Do not use the production CoalByte database.

Each test run must:

1. Create or obtain an isolated database/schema.
2. Apply all numbered migrations from an empty starting state.
3. Verify the migration ledger and expected tables/indexes.
4. Seed deterministic test fixtures.
5. Exercise repositories and Core API operations.
6. Verify persisted rows and transaction boundaries.
7. Clean up the disposable database after the run.

Required integration scenarios:

| Area | Required scenarios |
|---|---|
| Migrations | Clean install, repeat run, expected schema, failure visibility, safe rerun after an interrupted idempotent migration |
| Identity and members | Create/update member, search, pagination, detail view, missing member |
| Staff and permissions | Authorized operation, missing permission, inactive staff, owner protections, last active Owner protection |
| Economy | Award, spend, adjustment, insufficient balance, negative balance prevention, duplicate idempotency key, daily limit, concurrent balance updates |
| Leaderboards | Lifetime/weekly/monthly aggregation, empty results, stable ordering |
| Tickets | Create, list, detail, claim, close, reopen, archive, rate, append message, invalid transition |
| Rewards | Create/update, claim, approve, reject/refund, fulfill, duplicate claim and invalid state |
| Audit | Successful writes produce audit entries; rejected operations do not create misleading success entries |
| Importer | Dry run performs no writes, apply inserts expected rows, rerun skips existing rows, original JSON remains unchanged |

Concurrency tests are especially important for balances, reward claims, and ticket state changes. They must verify that simultaneous requests cannot create duplicate transactions or invalid states.

### 3.3 Core API tests

Test the API boundary independently of the dashboard and Discord UI.

For every route, cover:

- Valid authenticated request.
- Missing or invalid internal authentication.
- Missing staff identity.
- Insufficient permission.
- Invalid path parameters, query parameters, and request body.
- Missing resource.
- Conflict or invalid state transition.
- Database unavailable or repository failure.
- Correct status code and stable response shape.

The API must derive authorization from trusted server-side identity and current permission data. It must not trust a role, permission list, guild ID, or actor ID supplied only by an untrusted client body.

### 3.4 Discord workflow tests

Use mocked Discord interactions for automated tests and a dedicated test guild for controlled end-to-end checks.

Required workflows:

- First-time setup wizard, validation, preview, save, and incomplete setup recovery.
- Help and command navigation.
- Member-facing commands versus staff-only commands.
- Verification success, rejection, and retry.
- Ticket panel creation, opening, claiming, closing, reopening, archiving, and transcript/message persistence.
- Moderation actions, hierarchy restrictions, reason capture, and audit logging.
- Public role assignment and removal restrictions.
- Economy awards, daily check-in, balance display, spending, and leaderboard.
- Reward browsing, claiming, staff review, rejection/refund, and fulfillment.
- API/database unavailable behavior with a clear safe error and no false success response.

Do not run destructive moderation or mass-notification tests in a production guild.

### 3.5 Dashboard tests

Required automated coverage:

- Authentication callback and session establishment.
- Staff authorization and permission refresh through Core API.
- Navigation visibility for each permission level.
- Member search, pagination, and detail pages.
- Economy history, balance adjustment, and leaderboards.
- Ticket list/detail and supported state actions.
- Reward catalog and claim review/fulfillment.
- Team management, including owner protections.
- Loading, empty, validation, error, and success states.
- Responsive layout and keyboard accessibility for critical flows.

At least one end-to-end test must prove a change made through Discord is visible in the dashboard, and a permitted dashboard action is reflected in Discord or the shared data model.

## 4. Security and reliability requirements

- Never put database passwords, Discord bot tokens, OAuth secrets, API shared secrets, or session secrets in source control, test fixtures, screenshots, or CI logs.
- Use separate credentials for local development, CI, preview/staging, and production.
- CI uses disposable credentials with the minimum privileges required.
- Production database access is restricted to the Core API host/network path. The dashboard must call the HTTPS Core API and must not connect directly to MySQL.
- Require HTTPS and authenticated service-to-service requests between dashboard and Core API.
- Validate and authorize every write on the Core API, even if the dashboard already hides the action.
- Apply request-size limits, input validation, and safe error responses. Never return raw SQL errors or secrets to clients.
- Log security-relevant actions with actor, guild, action, target, timestamp, and outcome. Avoid logging credentials or unnecessary personal data.
- Verify that retries cannot duplicate economy transactions, reward fulfillment, or other non-idempotent actions.
- A database outage must fail closed for writes. The bot/dashboard must not claim an operation succeeded if persistence failed.

## 5. Data migration and reconciliation gate

The JSON-to-MySQL importer and all future domain importers must be validated against a disposable database before production.

Required procedure:

1. Identify the exact source JSON snapshot and target database.
2. Take a timestamped backup of the source JSON outside the repository.
3. Take and verify a database backup before any production schema or data change.
4. Run the importer in dry-run mode and save its output.
5. Review expected inserts, skips, unsupported legacy fields, and warnings.
6. Apply only to the disposable database first.
7. Compare source and destination counts by domain and guild.
8. Compare representative records and important invariants: balances, transactions, staff permissions, ticket states, reward claims, and audit history.
9. Confirm a second import is idempotent and does not duplicate or overwrite records.
10. Record accepted exceptions, including legacy data that is intentionally not imported.
11. Obtain explicit approval before applying to production.

The migration report must distinguish imported, skipped, rejected, and not-yet-supported records. A successful script exit code alone is not sufficient evidence of parity.

The original JSON data must remain preserved until the new system has passed production verification and the retention/retirement decision is explicitly approved.

## 6. CI and merge gates

### Required pull-request checks

A pull request is not merge-ready until all applicable checks pass:

- Dependency install and lockfile consistency.
- Bot syntax/check script.
- Dashboard typecheck.
- Unit tests.
- MySQL migration and repository integration tests.
- Core API authorization/validation tests.
- Bot and dashboard production builds.
- Importer dry-run and idempotency tests.
- Secret scanning or equivalent repository secret checks.

CI must run on pull requests and on the protected release branch. The workflow must use a disposable MySQL service/container for database integration tests. It must not receive production credentials.

### Merge requirements

- Changes are on a feature/implementation branch, not committed directly to `main`.
- The PR describes scope, migration impact, compatibility behavior, test evidence, and rollback approach.
- No unresolved critical/high security issue or data-loss risk.
- All required checks pass on the latest PR commit.
- Any schema change has a reviewed migration and a test proving clean installation.
- User approval is obtained before merging or deploying this project.

## 7. Staging and production release procedure

### Staging

1. Deploy the exact candidate commit to a staging/preview environment.
2. Configure staging-only API and database credentials.
3. Apply migrations to a disposable/staging MySQL database.
4. Import a sanitized test dataset.
5. Run API, Discord test-guild, and dashboard smoke tests.
6. Verify logs, health endpoint, permissions, and cross-surface consistency.
7. Record the candidate commit SHA and test evidence.

### Production

Production rollout requires a separate explicit approval after staging passes.

1. Announce a maintenance window if the release can affect member-facing workflows.
2. Verify a fresh database backup and confirm restoration instructions.
3. Preserve a copy of the current JSON store and current deployment configuration.
4. Confirm rotated database credentials are configured privately on the host. Never send credentials in chat or commit them.
5. Apply only the reviewed migrations.
6. Run the reviewed importer and reconcile counts before enabling normalized reads/writes.
7. Deploy the approved Core API and bot/dashboard versions in the planned order.
8. Keep the previous storage path available until the new path passes smoke tests.
9. Verify health, database connectivity, staff permissions, tickets, rewards, and economy operations with controlled test records.
10. Monitor errors, latency, failed interactions, and database connection health.
11. Record the release commit, migration versions, import report, backup reference, and operator approval.

Do not combine a broad schema migration, data import, bot behavior change, and dashboard redesign into one unverified production step.

## 8. Rollback requirements

Rollback must be planned per release, not improvised after an incident.

- Keep the previous deployable application version available.
- Keep the original JSON snapshot and database backup.
- Prefer forward-compatible additive migrations. Do not assume a database rollback is safe after new writes have occurred.
- If the new application version is faulty, roll back the application while preserving the database for investigation.
- Switching `OVERLAND_STORAGE=json` does not copy new MySQL writes back into JSON. Before switching storage after MySQL has accepted live activity, stop writes and perform a documented export/reconciliation. Otherwise recent activity may be lost from the active view.
- Do not drop normalized tables or delete compatibility data as part of an application rollback.
- After rollback, verify bot startup, dashboard access, staff authorization, and critical member workflows.
- Document incident timeline, affected data, recovery actions, and follow-up fixes.

A destructive schema change requires its own separately reviewed recovery plan and verified restore rehearsal.

## 9. Operational smoke checks

After every staging or production release, verify:

- Core API health endpoint responds and reports the expected storage backend.
- Database pool can connect and execute a read.
- Bot is online and command registration matches the approved command architecture.
- Dashboard authentication and staff access work.
- Unauthorized staff actions are rejected.
- Member lookup and profile display work.
- A controlled economy transaction is persisted exactly once.
- Ticket create/claim/close and reward claim/review work in the test environment.
- Audit records are written for successful privileged actions.
- No repeated database errors, unhandled promise rejections, or interaction timeouts appear in logs.

Production smoke tests must use a designated test account and reversible/test-safe records. Do not issue real moderation actions or mass notifications as a smoke test.

## 10. Definition of done for Stage 2F

Stage 2F is complete when:

- This testing and release policy is approved.
- The current baseline and known coverage gaps are accurately recorded.
- The required test layers and domain scenarios are defined.
- MySQL migration, importer reconciliation, backup, and rollback gates are documented.
- CI/merge requirements are explicit.
- Staging and production release steps require separate approval.
- No production database migration, storage switch, merge, or deployment is implied by this document.

## 11. Implementation checklist for Phase 3

The following are implementation tasks, not claims that they are already complete:

- [ ] Add a disposable MySQL service to CI and run all migrations against it.
- [ ] Add repository integration tests for staff, members, economy, tickets, and rewards.
- [ ] Add importer dry-run, apply, idempotency, and source-preservation tests.
- [ ] Add Core API authorization and validation test coverage for every route.
- [ ] Add Discord workflow tests for setup, verification, moderation, roles, tickets, and rewards.
- [ ] Add dashboard critical-path tests and cross-surface consistency tests.
- [ ] Add migration failure/recovery and backup-restore rehearsal documentation.
- [ ] Add a release checklist to the PR template or release process.
- [ ] Confirm CI uses no production secrets or production database access.


## Phase 3 CI implementation update

The Phase 3 database workflow now starts an isolated MySQL 8.4 service and runs the versioned migration runner plus repository integration tests against a disposable `overland_test` database. The integration suite currently covers configuration/settings mirroring, audit writes, imported-style member ID resolution, member join/message/leave activity, role assignment, idempotent economy awards, moderation case history, overview aggregation, and transactional persistence/deletion of suggestions, reports, appeals, vouches, blacklist entries, temporary roles, and reminders.

This is a useful foundation, not complete domain coverage. Ticket/reward state transitions, campaign submission review, referral milestone idempotency, X API polling/delivery, full importer reconciliation, and restore rehearsal remain explicit test gates. A successful syntax/build/test run does not imply production migration approval.
