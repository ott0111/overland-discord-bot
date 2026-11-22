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
