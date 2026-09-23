# Stay View calendar upgrade

## Audit and implementation architecture

The application uses Next.js App Router, React, Tailwind, the existing Radix-based
`@yohobed/ui` kit, Phosphor icons and TanStack Query. NestJS uses Drizzle/PostgreSQL
with tenant RLS, JWT authentication, subscription entitlements and server-resolved
hotel role/property grants. CSS motion tokens and reduced-motion rules already exist.

Reservations follow inquiry/hold → pending/approved → checked in → checked out,
with cancellation/no-show and recovery workflows. Booking legs carry physical-room
history; the reservation pricer and stored nightly snapshots own prices. Date changes
use preview/commit with optimistic concurrency; checked-in moves split dated legs.
Folio, desk dialogs, remarks/tasks, room blocks, housekeeping and the composer are
reused. No alternative reservation engine or design system is introduced.

The original Stay View combines toolbar and reservation sheet in one page and uses
a CSS-grid background tape chart. It already supports category/floor grouping,
reviewed assignment and resize. Missing operational surfaces include personal
settings, contextual range actions, unit details, unassigned panel, source/status
filters and horizontal date moves. The old modal sheet prevents switching between
reservations with the grid visible. Readiness also incorrectly queried only the
check-in day's housekeeping record instead of carrying forward the latest state.

Target components: page orchestration, pure calendar model, persistent preferences,
toolbar/settings/filter panels, memoized tape bars, reservation panel, unit panel,
unassigned list and contextual quick actions. Server data stays in Query; user
preferences are scoped by user and property in local storage; transient selections
remain local; date and selected booking IDs use URL state. CSS backgrounds and
content visibility keep the room list bounded without per-night cell nodes.

Backend changes are additive calendar metadata and the housekeeping readiness fix.
Existing API mutation contracts, permission checks, audit trails and snapshots remain
authoritative. No database migration is required. Drag proposals never write directly;
date/price changes always pass through the existing review service.

## Product research

The prompt's REFERENCE_SOURCES.md and reference image package were not supplied.
Official New Calendar material reviewed on 2026-09-23:

- [Getting started](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/48372183498907-Getting-Started-with-the-New-Cloudbeds-Calendar)
- [Moves and assignment](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/55835270255131-Move-and-assign-reservations-on-the-New-Calendar)

Applied patterns: retain the grid behind panels, bounded date windows, de-emphasis
filters, personal display preferences, contextual range actions and explicit reviews
for date changes. Original YoHoBed components and styling are retained.

## Release verification

Run the existing CI pipeline (build, migrate, typecheck, API/domain/DB tests, browser
E2E and format). Browser coverage must include geometry, range actions, filters,
settings, panel switching, keyboard/reduced motion, a populated 200-room calendar,
assignment and date changes. Deploy only a verified commit, with a successful
pre-migration backup and authenticated live smoke checks.
