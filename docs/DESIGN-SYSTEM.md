# Overland Core — Visual Design System

**Status:** Stage 2E approved  
**Baseline:** Existing dashboard styles and shared UI primitives on phase-3-core-api-mysql  
**Scope:** Visual language, color tokens, typography, spacing, components, interaction states, responsive behavior, and accessibility. This document is a design specification only. It does not modify the live dashboard or Discord embeds.

## 1. Design direction

Overland Core should feel like a serious operations product for a finance/community platform: precise, calm, information-dense without feeling cramped, and easy to scan during day-to-day moderation and administration.

The current dashboard already establishes a dark charcoal and muted green direction. Preserve that recognizable foundation, but remove one-off styling and make every page use the same design rules.

Principles:
- **Operational clarity:** important actions, risk, ownership, and status should be obvious.
- **Quiet hierarchy:** use typography, spacing, and alignment before decorative effects.
- **Purposeful color:** green means positive/active, red means destructive/critical, amber means attention, and neutral surfaces carry most of the interface.
- **Consistent behavior:** the same action, table, filter, status, and empty state should look and behave the same across domains.
- **Responsive by default:** essential review and triage workflows must remain usable on smaller screens.
- **Accessible contrast:** muted text must still be readable; color must never be the only status indicator.

## 2. Color system

The values below formalize the existing dashboard direction. They are proposed dashboard tokens, not a claim that these are the official Overland Finance brand colors. Confirm them against the public brand assets before final visual implementation.

| Token | Proposed value | Usage |
|---|---|---|
| --oc-bg | #090C0B | Main application background |
| --oc-surface-1 | #101512 | Cards and primary panels |
| --oc-surface-2 | #141B16 | Raised panels, menus |
| --oc-surface-3 | #19221B | Hovered/selected surfaces |
| --oc-border | #29342D | Default borders |
| --oc-border-subtle | #1C261F | Dividers and low-emphasis borders |
| --oc-text | #EDF3ED | Primary text |
| --oc-text-secondary | #AAB7AC | Supporting text |
| --oc-text-muted | #849187 | Metadata and helper text |
| --oc-accent | #B6E36B | Primary accent and positive emphasis |
| --oc-accent-strong | #C8F18A | Accent hover/highlight |
| --oc-accent-soft | rgba(182,227,107,0.10) | Selected backgrounds |
| --oc-success | #79C98A | Success states |
| --oc-warning | #E8BD6B | Warnings and pending attention |
| --oc-danger | #EF7777 | Errors and destructive actions |
| --oc-info | #83B7E8 | Informational states |

Rules:
- Most screens should be neutral. Accent color is for primary actions, selected navigation, positive metrics, and small highlights.
- Do not use green as a generic decoration on every card, chart, and border.
- Status badges include text labels or icons as well as color.
- Danger color is reserved for destructive actions and genuine errors.
- Avoid gradients on ordinary cards and controls. A subtle branded treatment may be used for the overview hero or login surface only.
- Charts use a restrained, consistent series palette and include legends/labels; do not rely on color alone to distinguish series.

## 3. Typography

Use the existing font direction unless brand review identifies a supplied typeface:
- **DM Sans:** page titles, body text, labels, navigation, buttons, and tables.
- **DM Mono:** IDs, timestamps, technical metadata, compact overlines, and system diagnostics.

Type scale:
- Page title: 28–32px, weight 700–800, tight line height.
- Section title: 15–18px, weight 650–700.
- Card title: 13–14px, weight 650–700.
- Body: 13–14px, line height 1.5–1.65.
- Table content and form labels: 12–13px.
- Metadata/overline: 10–11px; avoid using tiny text for important information.

Rules:
- Use sentence case for page and section titles.
- Reserve uppercase and letter spacing for short metadata labels, not paragraphs or navigation names.
- Use tabular numerals for balances, metrics, and timestamps where supported.
- Avoid reducing text size to fit dense tables; use responsive overflow or pagination instead.

## 4. Layout and spacing

Use a 4px spacing base with common steps of 4, 8, 12, 16, 20, 24, 32, and 40px.

- Sidebar: fixed desktop navigation with grouped sections and a clear active state.
- Main content: fluid width with a readable maximum content width.
- Header: compact, sticky only where useful, and never taller than the content requires.
- Page header: title, one-sentence purpose, and primary action in a predictable position.
- Cards: consistent padding (16–20px), border, radius, and title spacing.
- Page sections: 24–32px vertical separation.
- Tables: consistent row height, alignment, column spacing, and hover behavior.
- Forms: group related fields, show helper text beside the relevant control, and keep labels visible.
- Avoid nested cards unless a distinct sub-workflow genuinely needs its own container.

Corner radius:
- Small controls: 6–8px.
- Cards and panels: 10–12px.
- Large hero/auth surfaces: 14–18px.
- Pills: fully rounded only for compact status or filter chips.

## 5. Component standards

### Navigation
- One icon treatment and consistent icon sizing.
- Active route uses a subtle accent surface and a clear indicator.
- Group labels remain visually secondary.
- Mobile navigation opens as a drawer with a dismissible scrim and accessible focus behavior.

### Buttons
- Primary: one clear primary action per region; solid accent background with readable dark text.
- Secondary: neutral surface with border.
- Tertiary: low-emphasis text/ghost action.
- Danger: red treatment and confirmation for consequential operations.
- All buttons have hover, focus-visible, disabled, and loading states.
- Button labels use clear verbs: Save changes, Assign ticket, Approve claim, Close ticket.

### Forms
- Persistent visible labels; placeholders are examples, not substitutes for labels.
- Inline validation appears next to the field and explains how to fix the issue.
- Preserve entered values after validation or network errors.
- Show saving/saved/error states.
- Confirm before destructive resets or actions that affect many users.

### Tables and lists
- Consistent headers, row padding, alignment, and status badges.
- Search, filters, pagination, and sorting appear in a consistent toolbar.
- Long identifiers are truncated visually but remain available through copy/details.
- Row actions are discoverable and keyboard accessible.
- Provide useful empty states with a next action, not just “No data”.

### Cards and metrics
- Metric cards show label, value, and optional comparison/time window.
- Do not imply a metric is live if it is delayed or stale.
- Cards should not use decorative circles/glows as a substitute for hierarchy.
- Related actions should be placed consistently in the card header or footer.

### Feedback and status
- Loading: stable skeletons for page structures; compact spinner only for local actions.
- Empty: explain why the area is empty and what can be done next.
- Error: state what failed and provide a safe retry path.
- Success: concise confirmation near the action.
- Warning: identify what needs attention and the consequence.
- Permission denied: explain access is missing without exposing restricted data.

### Dialogs and destructive actions
- Dialog title names the action and target.
- Explain the consequence in plain language.
- Use explicit action labels rather than generic “Confirm”.
- High-impact moderation and bulk actions require a deliberate confirmation step.
- Never make destructive actions depend on color alone.

## 6. Data visualization

- Use consistent chart axes, units, time windows, and legends.
- Label metrics with definitions and date ranges.
- Use neutral chart scaffolding and accent colors for the data series.
- Keep chart gridlines subtle.
- Provide a table or text summary when chart interpretation is important.
- Clearly distinguish zero, missing, unavailable, and stale values.

## 7. Responsive behavior

- Desktop: full sidebar and multi-column dashboards where content benefits from comparison.
- Tablet: reduce columns and preserve page actions/filters.
- Mobile: drawer navigation, single-column cards, horizontally scrollable data tables with clear overflow, and stacked form actions.
- Keep essential ticket triage, moderation review, and approval workflows usable on mobile.
- Complex configuration may be desktop-optimized, but must remain readable and navigable on mobile.

## 8. Accessibility and interaction

- Meet WCAG AA contrast for normal text and controls.
- Visible keyboard focus on every interactive element.
- Semantic headings in order and semantic buttons/links.
- Inputs have programmatic labels and clear validation associations.
- Dialogs manage focus and support keyboard dismissal where safe.
- Respect reduced-motion preferences.
- Touch targets should be comfortably usable, with a target of at least 40px for primary mobile controls.
- Announce async success/error feedback to assistive technology.
- Never encode status using color alone.

## 9. Brand and asset rules

- Use the approved Overland Finance/Overland Core logo assets if present; do not substitute a text glyph as the final brand mark.
- Keep the product name consistent: **Overland Core** in product contexts; **Overland Finance** for the workspace/server identity.
- Do not introduce unrelated esports, gaming, or consumer-product visual language.
- Avoid unapproved illustrations, stock imagery, and decorative icon packs.
- The final icon set should use one consistent stroke weight and visual style.
- Confirm official logo clear space, minimum size, and approved color variants before replacing the current placeholder “O” mark.

## 10. Implementation and acceptance criteria

Before visual implementation:
1. Confirm the palette and logo against official Overland Finance brand assets.
2. Convert the tokens above into shared CSS variables.
3. Consolidate repeated styles into shared components rather than adding page-specific overrides.
4. Update the authenticated shell, navigation, page headers, cards, tables, forms, badges, dialogs, and feedback states.
5. Keep all existing page routes and workflows functional during the visual pass.
6. Verify keyboard navigation, contrast, responsive breakpoints, loading/empty/error states, and reduced motion.
7. Run dashboard typecheck and production build; add visual regression coverage for the shared shell and critical workflows.

Stage 2E is approved by the product owner. The visual direction, token set, component standards, responsive rules, and accessibility expectations are accepted as the target for implementation.

**Decision boundary:** This document is the design-system proposal only. It does not modify the live UI, change the dashboard information architecture, or authorize a production deployment.
