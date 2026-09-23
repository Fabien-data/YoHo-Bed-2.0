# Stay View command centre

Stay View is the front desk's workspace. The grid stays in view while the desk works:

- a stay opens in a side panel
- empty nights become reservations, holds or blocks where they are selected
- rooms and dates change by dragging, always through a review that says what will change
- every open calendar updates when another desk changes something

The benchmark was Cloudbeds' New Calendar (patterns only, in YoHoBed's own design system).

## Owner decisions (2026-09-23)

- **Courtesy hold** is a guest hold reservation (`hold_confirm` with a release time), started from
  the calendar with the composer prefilled. It is not a separate room-level concept.
- **Blocks have two kinds.** `out_of_service` is maintenance. `blocked` holds a sound room back
  from sale: owner use, staff, an event. Both take the room off sale and update channels.
- **Calendar settings** are saved in the browser, per user and per property.
- **Hotel-created roles** can reach every calendar action except payments. Payments wait for a
  separate money review.

## How it is built

**Server**

- `GET /stayview` returns one window in one request. It includes:
  - the property's `today` and `operatingDate`
  - each leg's version (`legUpdatedAt`) for safe edits
  - split-stay positions (`segment`)
  - block kinds
  - money, only for `financial_read`
- The chips describe today whenever today is on screen. A room move is not a due-out.
- Room changes:
  - Assign, unassign and move write `booking_approvals` rows (`room_assigned`, `room_moved`) with
    the actor and IP.
  - A guest who has not arrived moves whole.
  - An in-house guest is split at today. The vacated room is marked dirty and gets a turnover clean
    (`markRoomVacated`).
- Date changes:
  - Stays that have not arrived use stay-change preview and commit. A split stay is refused with
    409 `split_stay`.
  - In-house stays use `GET /bookings/:id/change-departure/preview`. It is a dry run of the real
    change, so the review shows exactly what Save charges, and complimentary or overridden rates
    are kept. The commit takes `expectedUpdatedAt`.
- Live updates:
  - Triggers on bookings, booking_rooms, maintenance_blocks, housekeeping_status, room_moves and
    payments call `pg_notify('yhb_property')`. Postgres delivers these only on commit.
  - `PropertyEventsService` listens, debounces per property and streams `GET /stay-updates`. The
    stream is filtered by tenant and property and ends after 15 minutes, so the client reconnects
    with a fresh token.
- Migration: `0042_stay_view_command_centre`.

**Web** (`components/stayview/`)

- `model/`: pure logic, unit-tested with vitest.
  - `dates.ts`: date-only arithmetic, no timezone drift.
  - `layout.ts`: the date-to-column geometry, column fitting, stacking, grouping.
  - `status.ts`: the semantic states.
  - `filters.ts`: reservation filters dim bars; room filters hide rooms.
  - `validity.ts`: what a gesture may do and whether a room can take a stay. This is advisory;
    the server decides.
  - `stats.ts`, `search.ts`, `prefs.ts`.
  - `actions.ts`: the stage-aware primary action, built on `lib/booking-actions.ts`.
- `interaction/`:
  - `store.ts`: hover, range and drag, held outside React props, so a pointer move never
    re-renders a row.
  - `use-grid-gestures.ts`: one pointer arbiter. It turns a press into a click, a range, a room
    move, a date move or a resize. It hit-tests by position, auto-scrolls and handles Escape.
- Grid, overlays and panels:
  - `calendar-grid.tsx`: the grid, with memoised rows. Highlights are written as DOM attributes.
  - `hover-card.tsx`: one hover card.
  - `panels.tsx`: `PanelHost`, plus the reservation, block, room and unassigned panels.
  - `review-dialogs.tsx`: room move and date change reviews.
- Controls and actions:
  - `controls.tsx`: filters, settings, legend and range controls.
  - `quick-actions.tsx`: the `+` menu, the action bar for selected nights, and the block dialog.
  - `stay-search.tsx`: search. Stays outside the window come from `/search`.
  - `context-menu.tsx`: the right-click menu.
- Smaller screens and navigation:
  - `mobile-day-list.tsx`: phones get a day list first.
  - `view-switch.tsx`: the Room view ⇄ Stay view switch.
- Styling is token-driven data attributes in `globals.css`. See docs/DESIGN-SYSTEM.md, "The Stay
  View calendar".
- Page state:
  - The URL carries `from`, `booking` and `unit`. Opening a panel pushes history, so Back closes it.
  - Preferences live in localStorage (`yoho-calendar:v2:<user>:<property>`, v1 migrated).
  - Folded groups and scroll position are kept per session.

## Keyboard

| Key     | What it does                           |
| ------- | -------------------------------------- |
| `/`     | search                                 |
| `N`     | new reservation                        |
| `+`     | quick actions                          |
| `T`     | today                                  |
| `[` `]` | previous or next dates                 |
| `U`     | unassigned stays                       |
| `,`     | settings                               |
| `Esc`   | clears a selection or closes the panel |

Also:

- Enter or Space on a stay opens it.
- The departure handle takes ← and → to shorten or extend by a night.
- Every drag has a form path: the panel's Move room and Change dates.

## Measured (200 rooms, 1,671 stays, dev build)

| Interaction                      | Result                       |
| -------------------------------- | ---------------------------- |
| Selecting nights                 | 60 fps, no long tasks        |
| Dragging a stay across 40 rows   | no long tasks                |
| Changing the window              | about 0.5 s                  |
| Switching to 30 days (923 stays) | about 0.4 s                  |
| DOM size                         | about 7,000 nodes at 14 days |

Row virtualization is not needed at this size.

## Running it locally

1. Migrate and seed.
2. Run `node scripts/demo-data.mjs`.
3. Build a showcase hotel:
   `DEMO_API_URL=… DEMO_TODAY=… node scripts/stayview-showcase.mjs`. This builds 50 rooms;
   `SHOWCASE_SCALE=4` builds 200.
4. Switch the property in the header, then open `/app/stayview`.

Browser tests can target another checkout's servers with
`E2E_WEB_PORT`, `E2E_API_PORT` and `NEXT_PUBLIC_API_URL`.

## Tests

- **API:** `test/stayview-desk.e2e.test.ts`
  - trail with actor
  - whole-stay versus split moves, and the turnover
  - split-stay 409
  - the departure preview matches the commit
  - block kinds and the payload
  - custom-role access and redaction
  - live updates: on commit only, per tenant and property
- **Web unit:** `components/stayview/model/model.test.ts`.
- **Playwright:**
  - `stayview.spec.ts`
  - `stayview-create.spec.ts`
  - `stayview-desk.spec.ts`: drag move, refusal, date move with price review, search outside the
    window, filter dimming, panel switching, settings persistence, assignment, housekeeping,
    context menu
  - `stayview-live.spec.ts`: two desks

## Not done yet

- A keyboard "move mode" (`M`, then arrow keys over the compatible rooms). The panel's Move room
  is the keyboard path for now.
- Row virtualization above ~300 rooms.
- Payments for hotel-created roles (a separate money review).
- Room View still uses its own housekeeping stream. It can move to `/stay-updates`.
