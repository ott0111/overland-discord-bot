# Overland Core — Dashboard Information Architecture

**Status:** Stage 2D approved  
**Baseline:** Existing dashboard routes and pages on `phase-3-core-api-mysql`  
**Scope:** Navigation, page hierarchy, access boundaries, and dashboard workflow organization. This document does not redesign the visual system or change the live dashboard.

## 1. Dashboard goals

- Make the dashboard an operations console, not a collection of disconnected admin pages.
- Organize pages around the same product domains as the Discord bot.
- Put high-frequency tasks and actionable alerts first.
- Keep member, ticket, moderation, campaign, reward, and staff workflows discoverable.
- Show data freshness and system health honestly. Do not present compatibility-store or incomplete metrics as fully live/reconciled.
- Preserve every existing page and workflow through the restructure.
- Use Core API as the business-data boundary; Next.js handles UI and Discord OAuth only.

## 2. Proposed primary navigation

Use a compact sidebar with grouped sections. Sidebar groups can collapse; the active page remains clearly identified. On smaller screens, use a drawer with the same hierarchy.

| Navigation group | Page | Purpose |
|---|---|---|
| **Overview** | Operations Overview | Community health, actionable alerts, system status, recent audit activity |
| **Community** | Members | Search, member profiles, roles, balances, activity, history |
|  | Public Roles | Role catalogue, role requirements, assignments, history |
|  | Verification | Verification status, requirements, review and exception handling |
| **Support** | Tickets | Open/claimed/closed queues, ticket detail, transcript, assignment and lifecycle actions |
| **Safety** | Moderation | Cases, warnings, timeouts, bans, automod/security configuration and logs |
| **Engagement** | Economy | Point balances, transactions, earning rules, staff adjustments |
|  | Leaderboards | Lifetime, weekly and monthly rankings |
|  | Campaigns | Campaign lifecycle, submissions, review queue and gallery |
|  | Rewards | Catalogue, inventory, claims, approval and fulfillment |
|  | Referrals | Invite attribution, referral performance and milestone status |
|  | Achievements | Achievement definitions, progress and awards |
| **Administration** | Team | Staff roster, departments, roles and status |
|  | Permissions | Permission groups, granular permissions and access review |
|  | Integrations | X integration and external service status |
|  | Server Configuration | Welcome, verification, ticket, voice, moderation, economy and community settings |
| **Insights** | Analytics | Cross-domain reporting, trends and exports |
| **System** | System Health | API, database, bot, migration, job and integration health; deployment/runtime diagnostics |

The above groups are the proposed end-user navigation. Existing routes can be retained during migration and redirected or nested after parity is verified.

## 3. Existing page mapping

| Current page/route | Proposed destination |
|---|---|
| `/` | Overview → Operations Overview |
| `/members` | Community → Members |
| `/roles` | Community → Public Roles |
| `/welcome` | Community → Verification (welcome content becomes a Server Configuration tab) |
| `/tickets` | Support → Tickets |
| `/moderation` | Safety → Moderation |
| `/points` | Engagement → Economy |
| `/leaderboards` | Engagement → Leaderboards |
| `/campaigns` | Engagement → Campaigns |
| `/rewards` | Engagement → Rewards |
| `/referrals` | Engagement → Referrals |
| `/achievements` | Engagement → Achievements |
| `/team` | Administration → Team |
| `/permissions` | Administration → Permissions |
| `/x` | Administration → Integrations → X |
| `/config` | Administration → Server Configuration |
| `/analytics` | Insights → Analytics |

This is an information-architecture proposal. Do not delete existing URLs until navigation and route migration have been implemented and tested.

## 4. Page-level workflow requirements

### Operations Overview
- Show only decision-useful metrics: members, joins, open tickets, pending moderation items, pending reward claims, pending campaign reviews, and points activity.
- Add an actionable attention queue with direct links to the relevant workflow.
- Show bot/API/database/integration status separately from community metrics.
- Include recent audit events with actor, action, target, and timestamp.
- Display last successful refresh and stale-data warnings.
- Do not claim real-time status if the source is cached, incomplete, or unavailable.

### Members
- Search and paginate.
- Member profile should consolidate identity, join date, roles, balances, achievements, check-ins, referrals, and relevant moderation/ticket history subject to permissions.
- Staff actions must be permission-gated and audited.
- Clearly distinguish Discord-sourced fields from Core API-managed data.

### Public Roles and Verification
- Public role catalogue, eligibility rules, assignment history, and configuration.
- Verification queue/status, rule requirements, and exception handling.
- Keep welcome message/channel configuration under Server Configuration rather than mixing it with verification review.

### Tickets
- Queue filters for status, assignee, age, and category.
- Ticket detail with member, messages/transcript, assignment, status history, and actions.
- Preserve Discord channel links and clearly handle deleted/missing channels.
- Transcript access must be permission-gated and audited.

### Moderation
- Searchable case log with filters by member, action, moderator, and date.
- Case detail, evidence/context references where available, reason, duration, and status.
- Separate moderation actions from automod/security configuration.
- Confirm high-impact actions and record audit events.

### Engagement
- Economy: balances, transactions, earning limits, point values, and adjustments.
- Leaderboards: lifetime/weekly/monthly with consistent ranking definitions.
- Campaigns: active/archived campaigns and submission review queues.
- Rewards: catalogue, inventory, pending claims, approvals, rejections/refunds, and fulfillment.
- Referrals: invite attribution and milestones.
- Achievements: definitions, eligibility, progress, and awards.
- All writes go through Core API and its domain rules.

### Administration
- Team: staff roster and status.
- Permissions: groups, permission keys, effective access, and audit history.
- Integrations: X credentials status (never display secret values), channel mappings, last successful sync, errors.
- Server Configuration: grouped tabs for Community, Welcome, Verification, Tickets, Voice, Moderation, Economy, Roles, and Integrations.
- Configuration forms must validate Discord resources, preview user-facing changes, and avoid silent overwrites.

### Insights and System Health
- Analytics must disclose time windows, definitions, and data coverage.
- System Health should report Core API, MySQL, Discord Gateway, bot heartbeat, migration version, scheduled jobs, and integration status.
- Do not expose secrets, raw connection strings, or sensitive operational data to users without the corresponding permission.

## 5. Global layout and interaction model

- Persistent sidebar with grouped navigation and clear active state.
- Header with current page, server/workspace context, data refresh state, and signed-in staff identity.
- Consistent page title, short purpose statement, primary action, filters, and content area.
- Tables support pagination, sorting where useful, search, and empty/error/loading states.
- Destructive actions use confirmation and explain the consequence.
- Forms preserve user input on validation errors.
- Detail pages use tabs only when they represent genuinely related information; avoid deeply nested navigation.
- Mobile layout supports essential triage and review, while complex configuration may remain desktop-optimized.
- Search and filters should be shareable via URL parameters where practical.

## 6. Permission model

Navigation visibility is a convenience, not a security boundary. Every protected page and every API operation must independently verify the staff session and required permission through Core API.

Proposed permission families:
- `community.view`, `members.view`, `members.manage`
- `roles.view`, `roles.manage`, `verification.view`, `verification.manage`
- `tickets.view`, `tickets.manage`
- `moderation.view`, `moderation.manage`
- `economy.view`, `economy.adjust`
- `campaigns.view`, `campaigns.manage`
- `rewards.view`, `rewards.manage`
- `referrals.view`, `analytics.view`
- `team.view`, `team.manage`, `permissions.manage`
- `integrations.view`, `integrations.manage`
- `config.view`, `config.manage`, `system.view`

Use the existing permission registry as the source of truth. New permission keys require a migration and explicit default-group policy. Public Discord roles must never imply internal staff access.

## 7. Data and API rules

- Dashboard pages do not import Prisma models or query PostgreSQL for business data.
- Dashboard server routes call Core API; Core API validates payloads, checks staff permissions, applies business rules, writes MySQL, and audits mutations.
- Discord-native facts (current channel/role/member state) may require Discord API lookups; persist business records through Core API.
- Every page documents loading, empty, error, stale-data, and permission-denied states.
- Data with incomplete migration coverage must show a coverage warning or remain unavailable until reconciled.
- Do not mix data from JSON, PostgreSQL, and MySQL in one metric without a documented precedence/reconciliation rule.

## 8. Migration and acceptance criteria

Stage 2D is complete when:
- Every existing dashboard route maps to a destination.
- Navigation groups and page ownership are clear.
- Core workflows and page-level requirements are documented.
- Permission boundaries are explicit.
- Core API/MySQL ownership is consistent.
- Existing pages remain available until replacements pass parity and tests.
- The structure has been approved by the product owner and is ready to guide the later dashboard redesign.

**Decision boundary:** This document defines dashboard information architecture only. Colors, typography, component styling, spacing, and visual brand rules belong to Stage 2E. This document does not modify the live dashboard or change route behavior.
