# Overland Core — Feature and Dependency Map

**Status:** Stage 2B deliverable  
**Baseline:** `phase-3-core-api-mysql` implementation branch  
**Purpose:** Inventory existing product capabilities, their entry points, dependencies, persistence, and migration state. This is an implementation map, not a redesign or a promise that every listed workflow is already production-ready.

## 1. System boundaries and dependency direction

### Target architecture

```text
Discord members/staff
        |
        v
Discord.js bot -----> Core API -----> CoalByte MySQL
        |                 ^
        |                 |
        +-- Discord API   |
                          |
Staff browser            |
   |                      |
   v                      |
Next.js dashboard --------+
   |
   +-- Discord OAuth callback/session bootstrap
       (identity handshake only; staff authorization is checked by Core API)
```

**Ownership rules**

- CoalByte MySQL is the intended single source of truth for Overland business data.
- Core API owns business-data access, validation, permission checks, and write-side rules.
- The Discord bot owns Discord interactions, event handling, channel/role/message operations, and command presentation. It must not become a second business-data authority.
- The dashboard owns presentation and the Discord OAuth sign-in boundary. It calls Core API for business data and must not query Prisma/PostgreSQL directly for those domains.
- Discord itself remains authoritative for Discord-native objects and state: guild membership, role/channel IDs, channel permissions, messages, and invite data exposed by Discord.
- JSON storage remains a compatibility/fallback path during migration. It is not the target source of truth.
- The legacy Prisma/PostgreSQL dashboard data path is transitional and must be removed only after all domains are migrated and reconciled.

## 2. Feature inventory

| Domain | Existing capabilities / workflows | Discord entry points | Dashboard surface | Data and dependencies | Migration status |
|---|---|---|---|---|---|
| Identity and member directory | Discord member identity, profile, join data, member search and detail | Member events; profile-related commands | Members | Discord Gateway; `users`, `discord_members`, guild membership; Core API | Dashboard member list/detail moved to Core API + normalized MySQL. Importer maps identity/profile. |
| Internal team and access control | Staff roster, departments, job titles, status, permission groups, owner bootstrap, granular permissions | Owner bootstrap and staff-only command guards | Internal Team; Permissions | Discord IDs; `internal_team_members`, `permission_groups`, `permissions`; Core API authorization | Team CRUD moved to Core API + normalized MySQL. Owner/last-owner safeguards and audit logging implemented. |
| Public roles and progression | Public role catalogue, grant/revoke, prerequisites, role history, Discord role sync, milestone progression | Role commands; member/progression events | Public Roles | Discord role IDs/API; `roles`, `member_roles`, `role_history`; role rules and achievements | Normalized tables exist; full role/progression workflow and dashboard route cutover remain outstanding. |
| Verification and anti-raid | Rules acceptance, verification challenge, account-age/avatar requirements, suspicious-account/raid checks, staff bypass | Verification commands and buttons; member join events | Welcome and Verification; Bot Configuration | Discord account metadata, member state, configured requirements, blacklist/anti-raid state | Primarily legacy store/JSON path; not fully migrated to normalized MySQL. |
| Economy and engagement points | Overpoints/Overcredits, daily check-in, streaks, participation/helpful/event awards, staff adjustments, balances, transaction history, earning caps | Economy commands: daily, profile, leaderboard, staff award/adjustment commands | Points and Economy; Leaderboards; Members | `point_balances`, `point_transactions`, `daily_checkins`, configuration; transaction/idempotency rules | Dashboard members, points, adjustments, and leaderboards moved to Core API/MySQL. Main bot economy commands moved for listed flows. Role/achievement progression and other award paths still need migration. |
| Campaigns and submissions | Campaign creation/activation, member submissions, staff review, approval rewards and submission history | Campaign commands | Social Campaigns | Campaign/submission records, staff permissions, economy transaction on approval | Normalized tables exist; importer and live bot/dashboard workflows are not fully cut over. |
| Rewards and claims | Reward catalogue, stock, Overcredits claim, pending-claim dedupe, staff approval/rejection, refund, fulfillment | Reward commands | Rewards | `rewards`, `reward_claims`, point balances/transactions; transactional stock/debit/refund rules | Bot and dashboard reward workflows moved to Core API/normalized MySQL in Phase 3.5. Historical data importer covers catalogue and claims. |
| Referrals and invites | Invite tracking, self-referral rejection, verification reward, retention milestone, Comrade conversion bonus | Referral commands and guild invite/member events | Referrals | Discord invite API/permissions; `referrals`, `referral_invites`, `invite_tracking`; scheduled retention job | Tables exist; importer/repositories and full bot/dashboard cutover remain outstanding. |
| Tickets and support | Open ticket, private channel, claim, close/reopen/archive, rating, ticket messages/transcript | Ticket slash commands and panel buttons; message events | Tickets | Discord channel API/permission overwrites; `tickets`, `ticket_messages`; support role/category configuration | Bot ticket actions and dashboard ticket routes moved to Core API/MySQL in Phase 3.5. New messages persist. Historical transcript messages are not imported yet. |
| Moderation and security | Automod filters, warnings, timeouts, kick/ban/unban, purge, lockdown, moderation history | Moderation commands and message events | Moderation and Security | Discord moderation permissions/API; `moderation_actions`; automod configuration and audit trail | Mostly legacy store/JSON path; normalized table exists but full cutover and test coverage remain outstanding. |
| Community and engagement | Welcome messages, info pages, social links, polls, spotlight, community stats/records, automations | Community/admin commands and Discord events | Overview; Bot Configuration; related community pages | Discord channels/messages; guild settings; `community_records`, `bot_configuration`; scheduler/automations | Mixed legacy store and partial Core API. Full dashboard/API and bot persistence migration remains. |
| X integration | Timeline polling, new-post announcements, manual announcement, duplicate filtering, post history | X announcement command and scheduled polling | X Integration | X API bearer token/rate limits; Discord announcement channel; `x_posts`; polling scheduler | Normalized table exists; full importer/repository and dashboard/bot cutover remain outstanding. |
| Analytics and leaderboards | Member/join/check-in/points overview, category totals, daily activity, lifetime/weekly/monthly rankings | Leaderboard command | Overview; Analytics; Leaderboards | Member, check-in, point, ticket, campaign and reward data; snapshots/jobs | Leaderboard dashboard route moved to Core API/MySQL. Overview and wider analytics still use legacy/compatibility data and need full migration/parity work. |
| Configuration and setup | Guild settings, point values/daily limits, channel/role mappings, ticket settings, verification/welcome settings, info/social content | Setup/configuration/community commands | Bot Configuration; Welcome and Verification; feature-specific settings | `bot_configuration`, guild settings, Discord channel/role IDs; validation and setup workflows | Configuration remains mixed. Some values are read from imported guild settings; dedicated normalized configuration ownership and complete setup workflow remain. |
| Audit and operations | Staff action history, API health, storage health, migration ledger, runtime logs | Bot/API runtime | Analytics/system surfaces where exposed | `audit_logs`, `core_migrations`, application logs, Core API health | Team/economy actions write normalized audit entries; dashboard staff audit forwarding was moved to Core API. Complete audit-domain migration and operational alerting remain. |

## 3. Cross-cutting dependencies

| Dependency | Used by | Failure or constraint to account for |
|---|---|---|
| Discord Gateway and REST API | Bot commands, events, role sync, tickets, moderation, welcome, invites, announcements | Bot intents, permissions, rate limits, guild/channel/role deletion, and API outages. |
| CoalByte MySQL | Target persistence for every business domain | Must be backed up, migrated, reconciled, and tested before production cutover. No production migration is authorized by this document. |
| Core API | Dashboard business-data access; normalized bot repositories/data operations | Must be reachable securely from the dashboard host; authenticated requests and per-request staff authorization required. |
| Next.js dashboard + Discord OAuth | Staff UI and sign-in | OAuth proves identity, not authorization. Every protected business operation must re-check staff status/permission through Core API. |
| Discord role/channel configuration | Role assignment, verification, tickets, moderation, announcements | IDs are guild-specific and can become stale; setup validation and useful error states are required. |
| X API v2 | Timeline polling and post announcements | Requires valid bearer token and appropriate access; rate limits and unavailable/protected content must be handled. |
| Scheduler/automation runtime | Referral retention, X polling, periodic snapshots and automations | Persistent/durable scheduling is required for jobs that must survive restarts; in-memory timers are not sufficient for critical delayed work. |
| Environment secrets | Discord token, Core API secret, database credentials, X token, dashboard OAuth/session secrets | Must remain in private host environment settings; never commit or paste secrets into source control. Previously exposed credentials must be rotated. |
| JSON compatibility store | Existing legacy bot features during transition | Single-instance/persistent-disk constraint; concurrent writers and split-brain data are unsafe. |
| Prisma/PostgreSQL legacy layer | Dashboard routes/domains not yet migrated | Transitional dependency only; cannot be retired until all reads/writes, auth, migrations, and data are moved and reconciled. |

## 4. Command and navigation inventory

The earlier audit counted **97 top-level slash commands** across these categories:

- Community: 31
- Moderation: 20
- Roles: 14
- Administration: 11
- Economy: 7
- Campaigns: 6
- Rewards: 5
- Referrals: 2
- Tickets: 1

The current loader recursively registers command modules individually. This inventory is a count by existing category, not a final approved command UX. Stage 2C decides the eventual grouped command structure and navigation; 2B only records what exists and which domain it belongs to.

The legacy dashboard inventory was **17 sections**:

1. Overview
2. Members
3. Public Roles
4. Internal Team
5. Permissions
6. X Integration
7. Welcome and Verification
8. Moderation and Security
9. Tickets
10. Points and Economy
11. Social Campaigns
12. Referrals
13. Rewards
14. Leaderboards
15. Achievements
16. Analytics
17. Bot Configuration

These are existing sections, not a final information architecture. Stage 2D decides the final dashboard navigation and page grouping.

## 5. Data ownership and cutover ledger

| Domain | Target owner | Current implementation reality |
|---|---|---|
| Team/staff permissions | Core API + MySQL | Normalized MySQL repository and Core API routes in place; legacy fallback remains for unimported records. |
| Members | Core API + MySQL | Dashboard list/detail reads use normalized MySQL. |
| Economy | Core API + MySQL | Dashboard points/adjustments/leaderboards and several bot economy commands use normalized MySQL. Remaining progression/award paths are not fully migrated. |
| Tickets | Core API + MySQL | Ticket dashboard and bot ticket paths use normalized MySQL in MySQL mode. Historical message import remains incomplete. |
| Rewards | Core API + MySQL | Dashboard and bot reward workflows use normalized MySQL in MySQL mode. |
| Roles/progression | Core API + MySQL | Tables exist; live workflow migration remains. |
| Verification | Core API + MySQL | Legacy store path remains; migration remains. |
| Campaigns | Core API + MySQL | Tables exist; workflow/import migration remains. |
| Referrals | Core API + MySQL | Tables exist; workflow/import migration remains. |
| Moderation | Core API + MySQL | Table exists; workflow migration remains. |
| Community/configuration | Core API + MySQL | Mixed compatibility store/config; normalized ownership remains incomplete. |
| X integration | Core API + MySQL | Table exists; workflow/import migration remains. |
| Analytics/audit | Core API + MySQL | Partial normalized queries/audit writes; broader data parity remains. |

**Migration rule:** a table existing does not mean a feature is migrated. A domain is cut over only when its importer, repository, Core API contract, bot path, dashboard path, permissions, audit behavior, and tests are complete and reconciled.

## 6. Known gaps and risks captured by the audit

- The existing architecture documentation describes a retired TypeScript/PostgreSQL/BullMQ layout and must be rewritten separately.
- JSON compatibility data and normalized MySQL records coexist during migration; dual-source behavior must be explicitly bounded and eventually removed.
- Historical ticket transcript messages are not imported by the current importer.
- Campaigns, referrals, moderation history, check-ins and other legacy arrays are not all mapped into normalized domain rows yet.
- Role progression and achievement award workflows remain coupled to legacy storage.
- Configuration ownership is mixed; point values/daily limits still use imported guild settings as a fallback.
- Overview/analytics calculations are not fully migrated to normalized MySQL and must not be treated as fully reconciled.
- The bot README and architecture documentation still describe JSON as the only persistence mode; update docs when the migration plan is finalized.
- Existing command count is close to Discord's 100-command ceiling; Stage 2C must account for this.
- Ticket setup and other configuration flows need validation and end-to-end testing; a command existing does not prove the workflow is complete.
- Critical background jobs need durable scheduling semantics and restart tests.
- Production CoalByte credentials previously shared in chat must be rotated before any production connection. No production migration or write has been performed.

## 7. Definition of done for Stage 2B

Stage 2B is considered complete when the team agrees that:

- Every existing product domain and user-facing workflow is represented above.
- Each domain has a clear Discord entry point, dashboard surface, persistence owner, and external dependencies.
- Current transitional storage and migration gaps are visible rather than hidden behind the target architecture.
- Stage 2C, 2D, and 2F can use this inventory without re-auditing the repository from scratch.

This document closes the feature/dependency inventory. It does **not** approve the proposed command redesign, dashboard navigation, visual design system, or production database cutover.
