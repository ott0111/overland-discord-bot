# Overland Core — Discord Command Architecture

**Status:** Stage 2C proposal for approval  
**Baseline:** Existing command modules on `phase-3-core-api-mysql`  
**Scope:** Discord command grouping, user-facing command navigation, staff/member separation, and migration rules. This document does not implement or register a new command structure.

## 1. Product principles

1. Members should see a small, predictable set of commands. Staff tools should not clutter member discovery.
2. Group related actions under one domain command, with consistent verbs and naming.
3. Keep every useful existing workflow. Consolidation means moving functionality behind grouped subcommands, not deleting it.
4. Prefer guided setup and interactive panels for multi-step configuration; avoid making staff memorize long command names.
5. Enforce permissions in the bot and Core API. Hiding a command from the UI is not authorization.
6. Use ephemeral replies for private account, verification, and staff feedback where appropriate.
7. Destructive/moderation actions must have clear targets, reasons, confirmation for high-impact actions, and audit records.
8. Discord is the interaction surface; Core API/MySQL remains the business-data authority.

## 2. Proposed top-level command map

The target is **13 top-level commands**, grouped by user intent. Discord's 100-command application limit is not the target UX.

| Top-level command | Audience | Purpose | Subcommand groups / actions |
|---|---|---|---|
| `/help` | Everyone | Discover commands and get context-aware help | `commands`, `topic`, `staff` (staff-only content) |
| `/setup` | Owner/admin | Guided first-time setup and health checks | `start`, `status`, `validate`, `test`, `finish` |
| `/config` | Authorized staff | Manage existing guild feature settings | `community`, `verification`, `tickets`, `voice`, `moderation`, `economy`, `roles`, `integrations`, `view`, `reset` |
| `/community` | Everyone / staff by action | Member-facing community tools and content | `info`, `rules`, `socials`, `suggest`, `report`, `appeal`, `poll`, `remind`, `spotlight`, `rep`, `vouch`, `member`, `server`, `voice` |
| `/moderation` | Authorized moderators | Moderation actions, cases, and security | `warn`, `warnings`, `timeout`, `untimeout`, `kick`, `ban`, `unban`, `purge`, `lock`, `unlock`, `slowmode`, `nickname`, `role`, `case`, `history`, `logs`, `lockdown`, `security` |
| `/tickets` | Members and support staff | Support lifecycle | `panel`, `open`, `claim`, `close`, `reopen`, `archive`, `rate`, `list`, `view` |
| `/roles` | Members and authorized staff | Public role discovery, assignment, and history | `list`, `menu`, `interests`, `grant`, `remove`, `history`, `config` |
| `/verification` | Members and authorized staff | Verification and Comrade checks | `start`, `answer`, `panel`, `status`, `verify`, `unverify`, `setup` |
| `/economy` | Members and authorized staff | Points, balances, and earning actions | `profile`, `daily`, `leaderboard`, `award`, `adjust` |
| `/campaigns` | Everyone / campaign staff | Campaign discovery and submissions | `list`, `view`, `create`, `submit`, `mine`, `gallery`, `review` |
| `/rewards` | Everyone / reward staff | Reward catalogue and claim lifecycle | `list`, `claim`, `create`, `review`, `fulfill` |
| `/referrals` | Everyone | Referral links, invite attribution, and progress | `invite`, `stats`, `leaderboard` |
| `/staff` | Authorized staff | Team, analytics, and staff operations | `team`, `permissions`, `stats`, `analytics`, `modlog`, `x` |

**Command count target:** 13 roots, with nested subcommands. The final Discord schema must respect Discord's limits on subcommands/options and keep each root's action count manageable. If a group approaches the limit, split by clear domain rather than returning to dozens of unrelated top-level commands.

## 3. Existing command-to-target mapping

This table preserves the current command modules and identifies where each capability belongs. The old command names are migration references, not a commitment to keep every old top-level name.

| Existing module(s) | Target location |
|---|---|
| `help` | `/help` |
| `community-setup`, `ticket-setup`, `voice-setup`, `welcome-setup`, `autorole`, `x-setup` | `/setup` for first-run flow; `/config` for later edits |
| `info`, `info-set`, `link`, `socials`, `rules` | `/community info`, `/community socials`, `/community rules`; staff edits under `/config community` |
| `suggest`, `report`, `appeal`, `poll`, `reminder`, `spotlight`, `spotlight-set`, `rep`, `vouch` | `/community` |
| `avatar`, `banner`, `serverbanner`, `servericon`, `serverinfo`, `channelinfo`, `roleinfo`, `userinfo`, `membercount`, `member-record`, `voice`, `botinfo`, `ping`, `uptime` | `/community member`, `/community server`, or `/help` diagnostics |
| `ban`, `unban`, `kick`, `warn`, `warnings`, `timeout`, `untimeout`, `mute`, `clear`, `purge`, `lock`, `unlock`, `lockdown`, `slowmode`, `nickname`, `temporary-role`, `case`, `mod-history`, `modlogs`, `security` | `/moderation` |
| `ticket` | `/tickets`; panel publication/configuration under `/config tickets` |
| `grant-role`, `remove-role`, `role-config`, `role-history`, `role-menu`, `interests` | `/roles` |
| `verify`, `verify-answer`, `verify-panel`, `verification-panel`, `verification-setup`, `verify-user`, `unverify`, `comrade-verify` | `/verification`; requirements configured under `/config verification` |
| `daily`, `profile`, `leaderboard`, `contribution-award`, `event-award`, `helpful-award`, `points-adjust` | `/economy` |
| `campaign-create`, `campaigns`, `submit`, `my-submissions`, `campaign-gallery`, `campaign-review`, `campaign-info` | `/campaigns` |
| `rewards`, `reward-claim`, `reward-create`, `reward-review`, `reward-fulfill` | `/rewards` |
| `invite`, `referrals` | `/referrals` |
| `team`, `permissions`, `staff-stats`, `analytics`, `modlog`, `x-announce` | `/staff`; X controls under `/config integrations` |

## 4. Member vs staff experience

### Member-visible by default
- `/help`
- `/community` member actions and information
- `/tickets open`
- `/roles list`, `/roles menu`, `/roles interests`
- `/verification start` and `/verification answer`
- `/economy profile`, `/economy daily`, `/economy leaderboard`
- `/campaigns list/view/submit/mine`
- `/rewards list/claim`
- `/referrals invite/stats`

### Staff-only
- Setup and configuration changes
- Moderation actions and case history
- Ticket claim/close/reopen/archive and ticket administration
- Role grants/removals and role configuration
- Manual verification and unverification
- Economy awards and balance adjustments
- Campaign creation/review
- Reward creation/review/fulfillment
- Staff/team/permission management, analytics, and integrations

Staff-only actions require the relevant granular permission. Owner bypass is limited to the explicitly defined Owner policy. Public Discord roles must never grant internal staff permissions.

## 5. Interaction and response standards

- Use one consistent Overland embed/component system, with clear titles, concise descriptions, restrained color use, and consistent field ordering.
- Use buttons/select menus for common navigation and repeat actions; slash commands remain the reliable direct entry point.
- Use modals for multi-field submissions (suggestions, reports, ticket details, campaign submissions) where Discord supports them.
- Ephemeral responses for private status, personal balances, verification prompts, and staff confirmations.
- Paginate long lists. Never dump an entire roster, transaction history, or moderation log into one embed.
- For destructive actions, show the target and reason before execution; require a confirmation step for high-impact bulk or irreversible operations.
- All writes should produce consistent audit records and clear success/failure feedback.
- Permission denial should explain the missing permission without leaking private staff or security data.
- Commands should validate required channel/role configuration and give a setup hint instead of failing with raw API errors.

## 6. Setup and configuration flow

### `/setup start`
Guided checklist:
1. Confirm bot permissions and required intents.
2. Select/validate welcome and rules channels.
3. Configure verification requirements and verified role.
4. Configure support category, support role, and ticket panel channel.
5. Configure moderation log channel and automod settings.
6. Configure public roles and role mappings.
7. Configure economy values and earning limits.
8. Configure optional X integration.
9. Preview generated panels/messages and run safe tests.
10. Show readiness summary and outstanding blockers.

### `/setup status` and `/setup validate`
- Show configured, missing, invalid, and optional items by feature.
- Verify the bot can access selected channels and roles.
- Never silently overwrite an existing configuration.
- Provide a repair path for invalid IDs and deleted Discord resources.

### `/config`
After initial setup, staff can update one feature without re-running the entire wizard. Changes should be previewed where user-facing content or permissions are affected.

## 7. Migration and compatibility rules

1. Do not delete or disable existing commands as part of the planning document.
2. Build grouped commands alongside the current modules on a feature branch.
3. Map each old command to its new action and verify option/permission parity.
4. Reuse existing service/repository business logic; do not duplicate workflows in new command handlers.
5. Register the new schema in a test guild first and validate all command names, options, permissions, and autocomplete.
6. Keep old commands available until the grouped replacement passes functional tests and the user approves the cutover.
7. Provide a short transition period with helpful deprecation responses only after parity is proven.
8. Do not register both old and new top-level schemas if doing so risks Discord's 100-command ceiling.
9. Preserve existing command behavior unless a separately approved product decision changes it.
10. Production command registration is a release action and requires explicit approval.

## 8. Acceptance criteria for Stage 2C

- Every existing command module is mapped to a target domain and action.
- The proposed top-level structure is understandable to members and staff.
- Member-facing and staff-only actions are separated.
- Granular permissions, Owner policy, and audit requirements are explicit.
- Setup/configuration has a guided path and ongoing edit path.
- No existing useful functionality is discarded.
- Command registration limits and migration compatibility are accounted for.

**Decision boundary:** This document proposes the target command architecture. It does not change command files, register commands with Discord, or authorize production deployment. Stage 2C can be marked complete once the product owner approves this structure.
