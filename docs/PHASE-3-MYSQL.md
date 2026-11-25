# Phase 3: MySQL foundation

This is the first migration step, not the completed database cutover.

## What is in place

- The Discord bot has a shared mysql2 connection pool.
- Versioned SQL migrations create the migration ledger and guild_state table.
- The bot can use MySQL for its existing guild-state store when OVERLAND_STORAGE=mysql.
- The existing JSON store remains the default when OVERLAND_STORAGE=json or the variable is unset.
- The JSON importer is explicit and non-destructive. It never deletes or edits the source JSON file, and it skips destination guilds that already exist.
- The Core API health endpoint reports which storage backend is active.
- Dashboard staff permissions and audit writes are now checked/forwarded through the Core API rather than trusting stale session permissions or writing audit rows directly through Prisma.

## Important scope limitation

The initial MySQL table stores each guild's existing state document as JSON. This is a compatibility bridge that lets us move the source of truth without rewriting every bot feature at once. It is not the final normalized relational model. The old PostgreSQL Prisma schema and dashboard routes that still use Prisma must be migrated in later Phase 3 work before PostgreSQL can be retired.

## Configuration

Use individual connection variables rather than pasting a raw connection URI. This avoids URL-encoding mistakes when a password contains reserved characters.

Set these in the bot host's private environment:

- OVERLAND_STORAGE=mysql
- DATABASE_HOST
- DATABASE_PORT=3306
- DATABASE_USER
- DATABASE_PASSWORD
- DATABASE_NAME
- DATABASE_POOL_SIZE=5
- DATABASE_SSL=false unless the provider requires TLS

Keep OVERLAND_STORAGE=json until the database has been reviewed and imported. Never commit .env files or credentials.

## Import procedure

1. Back up bot/data/overland.json and keep the backup outside the repository.
2. Configure the MySQL variables in a non-production/test database first.
3. Run node bot/scripts/import-json-to-mysql.js. This is a read-only dry run. It reports the number of source guilds and how many destination rows already exist.
4. Review the output and verify the target database is correct.
5. Run node bot/scripts/import-json-to-mysql.js --apply only when you intentionally approve schema creation and import.
6. Confirm the inserted/skipped counts and inspect the guild_state rows.
7. Only then set OVERLAND_STORAGE=mysql for the bot and restart it.

The importer uses INSERT IGNORE; it will not overwrite existing destination guild records. If a destination row already exists, reconcile it manually rather than deleting or blindly replacing it.

## Rollback

To return the bot to JSON storage, set OVERLAND_STORAGE=json and restart. The original JSON file is preserved. Any changes made after switching to MySQL will not automatically be copied back to JSON, so export/reconciliation is required before rollback if MySQL has accepted new activity.

## Production safety

Do not run the importer against the live CoalByte database until the database password has been rotated and the import has been reviewed against a backup. No production database connection or write is performed by this branch.

## Team management cutover

The normalized MySQL team repository now backs the dashboard Team Management API:

- Listing, adding, updating, and removing staff records run through the Core API.
- The dashboard route no longer imports or queries Prisma for team records.
- Core API rechecks the acting staff member and required permission for each operation.
- Owner appointment and last-active-Owner protections are enforced inside MySQL transactions.
- Team changes are recorded in the existing audit stream.
- Migration 0003 adds the `team.view` permission for Owner, Executive, and Administration groups.

This is a first domain cutover, not a full dashboard migration. Achievements, campaigns, configuration, leaderboards, members, moderation, permissions, points, referrals, rewards, roles, tickets, and X routes still contain Prisma-backed operations and must be migrated before PostgreSQL can be removed.

The team API requires `OVERLAND_STORAGE=mysql`. It is not enabled against JSON mode. Validate it against a disposable MySQL database before production use.

## Member and economy cutover

The dashboard's member and economy read paths now use Core API and normalized MySQL repositories:

- Member directory search and pagination.
- Member detail records, including normalized roles, achievements, point transactions, daily check-ins, and referral relationships.
- Economy transaction history and point-value/daily-limit settings. Imported guild settings remain the fallback source for those settings until dedicated configuration migration is complete.
- Staff balance adjustments for Overpoints and Overcredits, performed in a database transaction with non-negative balance validation and a normalized audit-log entry.
- Lifetime, weekly, and monthly leaderboards.

The dashboard API routes for `members`, `members/[id]`, `points`, and `leaderboards` no longer query Prisma directly. Core API validates the acting staff member and required permission before accessing the MySQL repository.

This does not migrate the bot's own economy service yet. Existing Discord commands and background operations that still use the JSON-compatible store must be moved to normalized repositories separately. The remaining dashboard routes also still need migration.

## Bot economy command cutover

When `OVERLAND_STORAGE=mysql`, bot economy operations now use normalized MySQL repositories instead of writing economy balances and transactions into the compatibility `guild_state` document:

- Staff award commands write to `point_balances` and `point_transactions` transactionally.
- Daily check-ins and streak bonuses use `daily_checkins` and normalized point transactions, with duplicate-day and daily earning-limit checks.
- Overcredit spending uses a locked balance row and an idempotency key.
- Member economy profiles and bot leaderboards read normalized balances and transactions.
- Helpful-award values read the imported guild settings from MySQL.
- JSON mode remains available as the compatibility path until the production cutover is approved.

This is the economy-command cutover, not a full bot-data cutover. Role progression and achievement award workflows still need their own normalized implementation. Validate the MySQL mode against a disposable database before enabling it on CoalByte.

## Phase 3.5: Tickets and rewards

- Normalized ticket and reward repositories now support ticket listing/detail, claim/close/reopen/archive/rating actions, reward creation/updates, reward claims, approvals, rejection refunds, and fulfillment.
- Core API exposes the ticket and reward operations with per-request staff permission checks.
- Dashboard ticket and reward routes now call Core API instead of querying Prisma directly.
- Bot ticket creation, claim, and close operations use normalized MySQL records in MySQL mode.
- Bot reward browsing, creation, claiming, review, rejection/refund, and fulfillment use normalized MySQL records in MySQL mode.
- Migration 0004 seeds ticket and reward viewing permissions.
- The JSON importer now includes existing reward catalog entries, reward claims, and ticket records, while preserving the original JSON file and using insert-if-absent semantics.

This cutover still requires integration tests against a disposable MySQL database. Ticket transcript messages and the complete historical ticket message archive are not imported by this pass. Do not retire PostgreSQL or enable the production MySQL cutover until all remaining dashboard routes and their data models have been migrated and reconciled.

## Phase 3.6: Public role configuration and guide foundation

- Added a normalized MySQL role repository for listing, creating, and updating public role definitions, Discord role mappings, prerequisites, point thresholds, and configuration metadata.
- Added Core API `GET`, `POST`, and `PATCH` routes for role management with per-request `roles.manage` authorization.
- Moved the dashboard Public Roles API route from direct Prisma queries to Core API.
- Updated the legacy `/role-config` command to write Discord role mappings to normalized MySQL when MySQL mode is active; role synchronization resolves the mapping from MySQL in that mode.
- Added `/role-guide`, which publishes or refreshes a persistent, multi-embed public role guide using configured role descriptions, role mentions, point thresholds, prerequisites, and optional guide instructions. Guide message IDs are stored in `bot_configuration`.
- Added `docs/ROLE-PROGRESSION-GUIDE.md` to define the broader configurable guide and progression requirements.

This is the role-configuration and guide foundation, not the complete role/verification cutover. Automatic role progression, member-role assignments and history, verification state/challenges, X-follow verification, achievements, and all relevant dashboard flows still require normalized repositories, Core API contracts, bot integration, import reconciliation, and tests. The guide currently renders the configured role metadata; it does not invent missing Overland earning rules or point thresholds. Validate the new path against a disposable MySQL database and a test Discord guild before enabling MySQL mode in production.

## Phase 3.7: Normalized roles and verification foundation

- Expanded the normalized role repository to support member role grants/revocations, prerequisite checks, role history, and idempotent automatic progression.
- Automatic progression currently preserves the legacy Overland rules imported from JSON: Citizen requires verification; Comrade requires Citizen plus verified X follow; Socialite requires 500 Overpoints; Creator and Intellect use their existing approved-submission category thresholds.
- The JSON importer now ensures the official Overland role catalogue exists for each imported guild, imports Discord role mappings, preserves existing member-role assignments, imports role history, and seeds the current progression metadata without overwriting non-empty custom role configuration.
- Verification challenge state and rules acceptance are stored in normalized member profile JSON. Verified status, X-follow status, and suspicious-account status use normalized `discord_members` fields.
- The `/rules`, `/verify`, `/verify-answer`, `/verify-user`, `/unverify`, and `/comrade-verify` flows now use normalized MySQL state when MySQL mode is active. The verification button flow is also connected to the normalized state.
- Role progression is re-evaluated after daily check-ins and the existing staff point-award commands; newly earned roles are synchronized to Discord using the MySQL role mapping.
- Role-related staff commands and the updated economy award commands use an asynchronous permission check against normalized staff records in MySQL mode. The environment-configured Owner is bootstrapped into normalized team storage on bot startup when MySQL mode is active.
- The dashboard Public Roles editor supports Discord role IDs and per-role guide instructions; the guide command resolves configured role IDs into Discord role mentions and warns when mappings are missing or stale.
- The dashboard Public Roles surface now allows staff to set Discord role IDs and continues to call Core API rather than Prisma.
- Role history reads from normalized MySQL in MySQL mode.
- The `/role-guide` command publishes or refreshes the role catalogue as persistent branded Discord embeds.

Remaining limitations: verification settings, blacklist records, role-menu panel configuration, achievements, and some community/submission/referral workflows still use compatibility JSON or legacy paths. The role progression evaluator currently implements the existing Overland rules; richer multi-category and all-of/any-of requirement editing is defined in `docs/ROLE-PROGRESSION-GUIDE.md` but is not yet exposed as a complete dashboard editor. This work has not been tested against a disposable MySQL database or a live test Discord guild. Production migration remains unauthorized.

## Phase 3.8: Achievements cutover

- Added a normalized achievement repository for listing definitions, creating custom achievements, evaluating member eligibility, and recording member awards.
- Added migration 0005 to seed the `achievements.manage` permission for Owner and Administration.
- The JSON importer now seeds the existing Overland achievement definitions and imports historical member achievement records without replacing existing definitions.
- Added Core API GET/POST achievement routes with per-request `achievements.manage` authorization.
- Moved the dashboard Achievements API away from direct Prisma access to Core API + MySQL.
- Bot achievement checks now use normalized records in MySQL mode. Existing conditions include verification, approved contribution/social/creative submissions, referrals, check-in counts, streaks, and Overpoints milestones.
- Achievement awards are idempotent. Configured Overpoints/Overcredits rewards are written transactionally with normalized point transactions.
- Achievement evaluation now runs during daily check-ins, verification, X-follow verification, and existing staff point-award flows. Newly awarded points are followed by role progression evaluation.

Remaining limitations: historical campaign submissions and referral records are not yet fully imported, so achievement kinds that depend on those records cannot be considered reconciled until those domains are migrated. Custom achievements currently use an Overpoints threshold; event-specific custom conditions and full achievement editing/deactivation remain future work. Validate against a disposable MySQL database before production.

## Phase 3.9: Campaign and referral migration progress

Campaign workflows are now backed by normalized MySQL in MySQL mode:

- Dashboard campaign listing, creation, and submission review use Core API and normalized repositories.
- Bot campaign browsing, creation, member submissions, review, and approved-submission gallery paths use normalized repositories.
- Submission approval awards category-specific Overpoints and records an idempotent point transaction.
- Historical campaign and submission records are imported non-destructively by the JSON importer.

Referral migration has now started:

- Added normalized referral repository operations for invite registration, referral joins, verification rewards, seven-day retention, Comrade conversion milestones, member referral stats, and dashboard statistics.
- The bot records newly created invites and backfills active invites during startup when MySQL mode is enabled.
- Referral dashboard reads now pass through Core API with `referrals.view` authorization; the dashboard route no longer queries Prisma.
- Migration 0006 seeds referral view/manage permissions.
- The JSON importer now maps historical referral and invite records into normalized tables without modifying the source JSON.

Referral migration is not yet complete. The legacy invite/reward history must be reconciled against a disposable MySQL database, and the milestone processor requires integration coverage for duplicate joins, self-referrals, suspicious referrals, verification reward idempotency, retention, and Comrade conversion. Do not enable production MySQL mode based on this partial cutover.

## Phase 3.10: Moderation history cutover

- Added a normalized moderation repository for case creation and dashboard history reads.
- Bot moderation commands now write their action records to MySQL when `OVERLAND_STORAGE=mysql`; JSON mode remains available as the compatibility path.
- Dashboard moderation history now reads through Core API and enforces `moderation.view`.
- Migration 0007 adds persistent case numbers and seeds moderation history view permissions.
- Historical moderation records are mapped by the JSON importer.

This migrates the moderation case-history data path only. Automod settings, blacklist records, anti-raid configuration, and all moderation configuration ownership still require a dedicated configuration migration. Test action logging, concurrent case numbering, missing/departed members, and history parity against a disposable MySQL database before production.

## Phase 3.11: Configuration, permissions, audit, and overview cutover

- Added normalized configuration read/write APIs in Core API using `bot_configuration`, with per-request staff authorization.
- Dashboard Configuration no longer queries Prisma. X Integration settings are also read and written through Core API.
- Configuration writes are mirrored into `guilds.settings` and the bot's compatibility guild state so existing Discord commands and event handlers see changes without a separate database authority.
- Bot `saveStore()` now synchronizes guild settings into normalized configuration rows, including point values, daily limits, verification, security, X, welcome, voice, role ID, and role-menu configuration.
- Dashboard permission-group listing and updates now use Core API and normalized `permission_groups` / `permissions` tables. Only Owners can change permission definitions, and permission keys are allowlisted.
- Team/permission changes refresh the bot's in-memory command permission cache. Startup also loads the normalized team roster before commands are used.
- MySQL staff authorization now fails closed: if a staff record is missing from normalized MySQL, the Core API does not fall back to stale JSON permissions.
- Audit writes and reads use normalized `audit_logs`; dashboard audit reads revalidate `audit.view`.
- Overview analytics now aggregate normalized member, ticket, reward-claim, campaign-submission, point-transaction, and check-in data through Core API.
- Migration 0008 adds member departure tracking. Guild member joins, leaves, and message activity update normalized member rows, and Overview excludes departed members from its active-member total.

## Phase 3.12: X integration cutover

- Dashboard X configuration and post history use Core API/MySQL; the dashboard no longer queries Prisma for X records.
- The bot uses `X_BEARER_TOKEN` from its private environment to poll the configured account through X API v2.
- The polling service honors enabled state, configured poll interval, reply filtering, and repost filtering.
- The initial poll stores a cursor without replaying old posts. New posts are inserted idempotently into `x_posts` and announced to the configured Discord channel. Failed deliveries remain pending for retry.
- Manual dashboard announcements are stored in `x_posts` and sent to the configured channel when the bot has access. The dashboard reports whether delivery actually succeeded.
- X credentials are rejected by configuration APIs and must remain private environment variables.

## Phase 3.13: Historical data and identifier compatibility

- JSON import now also maps configuration, X post history, audit events, community records, historical moderation actions, referrals/invites, campaigns/submissions, roles, rewards/claims, tickets, and supported economy data.
- Normalized repositories now resolve the actual existing user/member primary keys after an upsert. This is required because imported IDs are deterministic and differ from IDs generated for new live records; repositories must not assume an ID prefix.
- Integration coverage includes an imported-style member ID to prevent regressions in member activity, role assignment, economy awards, and moderation history.
- Migration 0008 adds `discord_members.left_at` and an index for active-member analytics.

## Phase 3.14: Disposable MySQL CI

- The Phase 3 database workflow now provisions a fresh MySQL 8.4 service container.
- CI applies all numbered migrations and runs repository integration checks against the isolated `overland_test` database.
- Integration tests cover migrations, configuration writes and settings mirroring, audit records, imported-style member identity resolution, member join/message/leave lifecycle, role assignment, idempotent economy awards, moderation case numbering/history, and normalized overview queries.
- The test runner refuses to execute the integration suite unless `RUN_MYSQL_INTEGRATION_TESTS=1` and the database name clearly identifies a test/CI database.
- This disposable CI database is not CoalByte production. It does not authorize a production connection, migration, storage switch, merge, or deployment.

## Remaining Phase 3 release gates

- Verify the newest full Core CI and disposable MySQL workflow runs pass on the current branch head.
- Expand MySQL integration coverage to every repository and workflow, especially ticket/reward transitions, referral milestones, campaign review/rewards, X polling/delivery, and migration reconciliation.
- Complete remaining live community-record/blacklist workflows and any remaining dashboard or bot configuration consumers.
- Review all data import counts and reconcile source JSON against normalized MySQL in a disposable database.
- Rotate the database password that was exposed in chat, privately configure the replacement in CoalByte, and confirm secure Core API connectivity without exposing MySQL publicly.
- Production backup, dry-run review, reconciliation, explicit approval, and controlled cutover remain separate required steps.
