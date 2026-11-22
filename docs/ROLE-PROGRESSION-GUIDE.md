# Overland Role Progression and Guide

**Status:** Phase 3 implementation requirement  
**Owner:** Core API + MySQL for role configuration and progression; Discord bot for role synchronization and message publishing.

## Goal

Provide one polished, persistent Discord guide that explains how members enter Overland, earn public roles, and progress through the community. The guide should use the visual structure of a well-designed Discord embed: clear section titles, short explanations, role mentions, point thresholds, channel mentions, and concise earning instructions.

This is an Overland feature. The supplied Acepyr example is a layout reference only; its role names, point values, account requirements, X requirements, trading rules, and channel names must not be copied as Overland policy.

## Member-facing guide

The published guide should support:

- An introduction explaining the Overland participation and points system.
- Entry requirements and verification instructions.
- A section for each configured public role, including its Discord role mention, description, eligibility requirements, and earning instructions.
- Point categories and their earning rules, where configured.
- Whether a role is permanent, removable, cumulative/stackable, or part of a highest-tier progression.
- Channel mentions for the relevant activities.
- A final section for special rankings or limited slots, only when configured.
- A last-updated timestamp and a stable message that staff can refresh.

Use Discord role and channel mentions from configured IDs, not hard-coded names. Missing or deleted IDs should produce a clear staff-facing validation warning rather than a broken guide.

## Configuration and role IDs

Staff must be able to configure each public role with:

- Display name and description.
- Discord role ID.
- Sort order.
- Eligibility prerequisites (for example, Citizen/Comrade verification).
- One or more progression requirements.
- Whether the role is permanent, stackable, or part of a highest-tier track.
- Whether the role is included in the public guide.
- Optional guide instructions and relevant channel IDs.

Role IDs are guild-specific and must be validated against the Discord guild before publishing or syncing.

Progression rules must be data-driven. Do not hard-code example thresholds or assume all guilds use the same role names or point categories.

## Points and progression

The role system must support requirements against the point categories Overland actually configures. It must not silently treat every point category as interchangeable.

- Keep Overpoints and Overcredits distinct.
- Support category-specific point requirements where the underlying earning system provides those categories.
- Support multiple requirements on one role, including all-of and any-of conditions when configured.
- Make progression idempotent so repeated events do not duplicate role history or awards.
- Re-evaluate role eligibility after relevant point, verification, campaign, referral, and other progression events.
- Record every automatic grant/revocation in role history with a system actor and reason.
- Respect staff exclusions or exemptions when configured.
- Never grant internal staff roles through public progression.

## Discord embed presentation

Use the shared Overland embed branding and Discord-supported Markdown. Organize content into readable sections, using role mentions and channel mentions where configured. Split across multiple embeds/pages when Discord message or embed limits would be exceeded. Do not rely on unsupported Markdown heading syntax or oversized descriptions.

Publishing should be safe to repeat: update the configured guide message when possible, otherwise create one and persist its channel/message IDs. Avoid posting duplicate guide messages on every setup run.

## Dashboard and command management

The dashboard Public Roles surface should eventually manage role IDs, requirements, progression behavior, display order, and guide content through Core API.

The Discord command structure should expose a staff-only guide publish/refresh action under the approved Roles command group. Existing useful role and verification actions must remain available during migration.

## Security, migration, and acceptance

- Core API owns validation and persistence for role configuration in MySQL.
- Bot role synchronization calls Discord only after the persisted eligibility decision.
- Dashboard role operations must not query Prisma directly.
- Import existing role definitions, Discord role mappings, member-role assignments, and role history non-destructively.
- Preserve the legacy JSON source until migration reconciliation and cutover are explicitly approved.
- Test role prerequisites, category thresholds, multiple requirements, stackable/highest-tier behavior, staff exclusions, deleted Discord roles, duplicate events, and repeated guide publishing against a disposable MySQL database and a test Discord guild.
- No production migration or storage switch is implied by this requirement.
