# Smart property setup and Stay View delivery

Approved decisions: included adult/child places are pricing allowances, separate from physical capacity; hotel-defined child age bands support fixed or adult-supplement percentage charges; meal plans derive from RO with explicit independent overrides; minimums protect hotel net room-and-meal revenue. Named physical rooms share category capacity/pricing. Guest occasions create tasks/extras. Custom roles grant actions and explicit property access. Housekeeping is online mobile web with property-defined inspection readiness. Stay View targets 50–200 rooms, with calm styling and drag changes reviewed before save. Unchanged nights keep agreed prices.

## Release gates

- [x] Additive draft configuration model and generated migration; legacy identifiers and snapshots preserved.
- [x] Shared eligibility and pricing rules, boundary tests, setup preview and explicit publication. Setup previews, PMS quotes, reservation creation and amendments use the shared calculator, while confirmed booking snapshots remain fixed.
- [x] Named rooms and atomic bulk creation with review.
- [x] Custom roles/property grants, server enforcement, privacy and same-token revocation tests.
- [x] Idempotent checkout housekeeping, property readiness checks, prompt synchronization and the phone-friendly housekeeping workflow.
- [x] Clickable Stay View prototype covering all six agreed scenarios.
- [x] User review of the prototype (required before full Stay View implementation).
- [x] Production Stay View workflows, reviewed drag/resize changes, form alternatives, concurrent-change validation, reduced motion, narrow layouts and a populated 200-room calendar.
- [ ] CI, migration rehearsal, authenticated browser verification and controlled VPS release.

## Compatibility

Existing rates remain authoritative until an explicit policy publication. No migration interprets occupancy labels as adult/child counts. Existing reservation prices never change from setup edits. Incoming confirmed channel bookings retain their contracted amount, with exceptions flagged. Unsupported provider capabilities block outgoing publication with an explanation; a fake provider does not constitute live OTA verification.

The older Room View animation edits are outside this checkout and release. Offline updates, individual-unit pricing, seasonal packages and approval queues are excluded.
