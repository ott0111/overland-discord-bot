# Normalized MySQL domain model

Migration `0002_relational_core.sql` introduces the relational domain tables used by Overland Core. It is intentionally additive: it does not drop, rename, truncate, or rewrite `guild_state` or the original JSON file.

## Domain areas

- Identity: `guilds`, `users`, `discord_members`
- Roles and access: `roles`, `member_roles`, `role_history`, `permission_groups`, `permissions`, `internal_team_members`
- Economy: `point_balances`, `point_transactions`, `daily_checkins`, `leaderboard_snapshots`
- Campaigns and rewards: `campaigns`, `campaign_submissions`, `rewards`, `reward_claims`, `achievements`, `member_achievements`
- Referrals: `referrals`, `referral_invites`, `invite_tracking`
- Community operations: `tickets`, `ticket_messages`, `moderation_actions`, `community_records`
- Integrations and operations: `x_posts`, `bot_configuration`, `audit_logs`

Guild-owned records carry `guild_id` and indexes scoped by guild. External Discord IDs remain strings, not numeric values. Application IDs are `VARCHAR(64)` so existing IDs and generated IDs can coexist. JSON columns are reserved for flexible metadata such as profile/configuration payloads, not as replacements for the relational entities and transaction records.

## Migration behavior

The normal migration runner applies numbered SQL files once and records each applied filename in `core_migrations`. MySQL DDL statements auto-commit, so a failed migration may leave some `CREATE TABLE IF NOT EXISTS` statements applied; rerunning is safe for these idempotent table definitions. Review database state before manually editing the migration ledger.

## Current transition state

`guild_state` remains the compatibility source used by the existing bot store. The normalized schema is additive. The importer now idempotently maps guild settings/stats, member identity/profile, balances, public roles, point transactions, internal staff records, and staff permission keys into relational tables. The staff repository reads active permissions from normalized tables and falls back to the compatibility store when a staff record has not yet been imported. Campaigns, submissions, referrals, rewards, claims, tickets, moderation history, check-ins, X posts, audit history, and other legacy arrays remain preserved in `guild_state` until their domain-specific importers and repositories are added.

Do not switch production to normalized reads until data import, permission seeding, and parity checks are complete. Do not point the importer at the production database until credentials have been rotated and a backup has been verified.


## Lifecycle and operational data additions

- `discord_members.left_at` records departure from the guild. Active-member analytics filter on `left_at IS NULL`; rejoining clears the departure timestamp while preserving the original join date.
- `bot_configuration` is the normalized per-guild configuration registry. Existing bot consumers are kept compatible through a synchronized `guilds.settings` JSON mirror during the migration.
- `audit_logs` is the normalized audit stream for migrated Core API operations.
- `x_posts` stores imported and live X post history, with idempotent post IDs and announcement delivery timestamps.
- `community_records` stores imported legacy suggestions, reports, appeals, vouches, blacklist records, temporary roles, and reminders. Live workflow cutover for all of these record types remains incomplete.
- User/member identifiers are resolved by querying the actual stored primary keys. Importer-generated IDs and runtime-generated IDs are not assumed to share a prefix.
