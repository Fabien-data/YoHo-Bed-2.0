# YoHoBed UX Standard

> The behavioural contract for every screen in YoHoBed 2.0. [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)
> says how a screen **looks**; this document says how it must **behave**: how many steps a job
> may take, how it protects the person doing it, and how they learn it. Both are binding. A
> sprint that breaks either does not ship.
>
> Adopted 2026-09-22 (UX Excellence Program, UX-0).

## 0. Why this exists

In 2025, Cloudbeds and two NYU hospitality professors surveyed 500 hotel employees in five
countries ("Hotel PMS User Experience"). What front-line staff said, in order:

- Their top complaint is **too many clicks** (36%).
- Next come **too many manual tasks** (29%), **systems that don't talk to each other** (26%),
  **reports that aren't automated** (25%) and **configuration limits** (25%).
- **Ease of learning** is the lowest-rated part of the experience, yet 73% of staff are still
  trained in person.
- Managers say new staff make mistakes at check-in and check-out, forget to enter guest details,
  and are afraid of getting it wrong in front of a guest.
- **38%** said their PMS contributed to their decision to leave a job.

The report is research, not a design spec, so there is nothing in it to "comply" with. What it
gives us is evidence of what hotel staff need. This standard turns that evidence into rules that can
be tested, and [§10](#10-measurement) makes "the easiest PMS to learn" a number we can check.

## 1. Principles

Each principle is a rule. **MUST** means a screen that breaks it is a bug.

| #   | Principle                           | Rule                                                                                                                                                                                              |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Fewest steps**                    | Every core task MUST fit its budget in §3. An action MUST be reachable where the work is: from the booking, the room or the row, not only from a different screen.                                |
| 2   | **Automate the routine**            | Work that follows a rule (releasing holds, posting nights, marking departures dirty, reminders) MUST be done by the system, with a visible record. The person decides the exceptions.             |
| 3   | **Always current**                  | A screen MUST NOT show stale data as if it were current. Two desks working at once MUST see each other's changes without a manual reload (target of UX-4).                                        |
| 4   | **Reports that read themselves**    | Every list MUST export. A number that needs explaining MUST come with its explanation on screen. Nobody should need Excel to answer "how did we do yesterday?".                                   |
| 5   | **Configurable and personal**       | A rule that differs between hotels (required guest fields, balance policy at check-out) MUST be a property setting, not code. Views remember how the person left them.                            |
| 6   | **Warn before it's a problem**      | A condition that will hurt within the shift (a dirty room for an arrival, a failed channel push, a missed night audit) MUST raise an alert, and the alert MUST link to the fix.                   |
| 7   | **Works away from the desk**        | Housekeeping and managers' views MUST work on a phone (§9).                                                                                                                                       |
| 8   | **Help one keystroke away**         | Every screen MUST have a help entry, and every error MUST say how to get help (§5, §7).                                                                                                           |
| 9   | **Learn by doing**                  | A new core task MUST ship with its help article, and front-desk procedures with a practice drill (UX-5).                                                                                          |
| 10  | **Hard to get wrong, easy to undo** | The server MUST refuse unsafe actions (§4), not just the UI. Reversible actions MUST offer Undo. Irreversible ones MUST ask with their consequence and, where money or inventory moves, a reason. |
| 11  | **Fast and never down**             | Speed budgets in §8. No screen MAY go blank on an error. Nothing about running the hotel MAY need downtime.                                                                                       |
| 12  | **One obvious path**                | A menu item and the page it opens MUST share a name. A task has one primary route, and its other entry points lead to the same component.                                                         |

## 2. How we count

- **C:** one click, tap, or committing key (Enter, or a shortcut such as Alt+N). Opening a dropdown
  and choosing from it is **2C**. Navigating to another screen costs its clicks too.
- **T:** one field typed into, however long the text.
- **Waiting is free** in a click budget and is measured separately (§8).
- The happy path is counted: the shortest route the product allows a person who knows it.

The harness that counts this in tests is `apps/web-extranet/e2e/support/budget.ts`. The budgets
live in `BUDGETS` there **and** in the table below, and must be changed together.

## 3. Task budgets

"Today" is the 2026-09-22 audit. The sprint named is the one that makes the budget a hard gate.

| Task                                                             | Budget        | Today                    | Gate     |
| ---------------------------------------------------------------- | ------------- | ------------------------ | -------- |
| Quick Reservation, new guest, 1 room × 2 nights on a chosen date | **≤ 8C + 3T** | 7C + 3T                  | ✅ UX-0  |
| Check in a prepared arrival (with the §4 checks)                 | **≤ 3C**      | 2C (was 4C, no checks)   | ✅ UX-1b |
| Full check-in: room, ID, registration card                       | **≤ 6C + 2T** | 4C + 1T (was ≈14C + 1T)  | ✅ UX-1b |
| Check out: settle, invoice, email                                | **≤ 5C + 1T** | 3C (was ≈16C, 3 screens) | ✅ UX-1b |
| Take a payment                                                   | **≤ 4C + 1T** | 2C (was 6C)              | ✅ UX-1b |
| Extend or shorten an in-house stay                               | **≤ 4C + 1T** | 3C (was impossible)      | ✅ UX-1b |
| Walk-in: reserve, check in, deposit, one sheet                   | **≤ 8C + 3T** | 8C + 2T + a page load    | UX-2     |
| Find a booking by name, phone or reference, from anywhere        | **≤ 2C + 1T** | 4C + 1T, often misses    | UX-2     |
| Move a guest to another room                                     | **≤ 3C**      | 7C, Room View only       | UX-2     |
| Post a standard charge (minibar, laundry)                        | **≤ 3C**      | 5–6C, typed by hand      | UX-2     |
| Mark a room clean, housekeeper's phone                           | **1 tap**     | 3C on the desktop        | UX-6     |

`e2e/budgets.spec.ts` drives each gated task through the harness. Every task not yet gated is
listed there as `fixme`, with the cost above, so the debt shows in every test run.

## 4. Safety rules

These are **server** rules. The UI explains them, but it never _is_ them.

- **Check-in** needs:
  - the arrival day to have come, judged by the hotel's operating date (the later of the business
    date and the calendar). An early guest's stay is moved to start today first.
  - a room, when the room type has numbered rooms: one is assigned, or the server picks a clean,
    free one. It must not be blocked or out of order.
  - a clean room, unless the check-in is explicitly overridden with a reason
  - an ID document, when the property requires one
- **Check-out** with an open balance is refused (409 `balance_open`), unless the balance is:
  - paid
  - moved to the city ledger
  - or overridden by an owner, with a reason
- **Every reversal of money or inventory records who did it and why.** That covers void, refund,
  cancel, no-show, credit note, undo check-in and undo check-out.
- **Recovery beats refusal.** A mistake at the desk must be fixable:
  - undo check-in, and undo check-out, on the same business date
  - reinstate a no-show or a cancellation while the room is still free
- **Night audit** shows what it will do before doing it (preview), and states what is unresolved
  (pre-checks). It never invents a number: an uncounted till is recorded as **uncounted**, never as
  "balanced".
- **Double-booking stays impossible at the database** (the gist exclusion on `booking_rooms`), and
  every create that can be retried is idempotent.
- **A room's housekeeping state carries forward.** A room stays dirty until someone cleans it. A
  status is never read from a single day's row as if a missing row meant clean.

**Where it stands (UX-1b, 2026-09-22).**

- **Enforced by the server:**
  - the check-in and check-out guards
  - undo check-in, undo check-out and reinstate
  - actor and IP on every lifecycle action
  - a reason on every void, and who did it
  - refunds: no more than was paid, with a reason, and the owner's approval for anyone else
  - the double-payment guard
  - an owner approving on the spot (step-up) for refunds and for a guest leaving with a balance
  - the housekeeping carry-forward
  - night-audit pre-checks, `keep`, the owner gate and uncounted tills
- **Asked for by every screen, not yet by the server:** a reason on cancel. It becomes mandatory
  once Room View moves onto the shared front-desk dialogs, because its cancel button still sends
  none.
- **Still to come:** approval for voiding a line whose price was owner-approved.

## 5. Feedback and errors

- **Every mutation gives feedback:** a toast on success, and on failure a message that stays until
  it is dealt with.
- **A reversible action's success toast carries Undo** (from UX-1b).
- **Confirmations use `ConfirmDialog`** (the safe choice is focused first). **`window.confirm` is
  banned.** A confirmation states the consequence ("The guest's room is released and the deposit
  stays on the folio"), not "Are you sure?".
- **An error tells the person what went wrong and what to do.** A field error sits on its field,
  and a bare "Validation failed" is banned.
- **A fault on our side says so plainly and shows a reference.** Every API response carries
  `X-Request-Id` (`R-xxxxxxxx`); `describeError()` in `lib/api.ts` turns it into the sentence the
  desk sees.
- **No screen goes blank.** `app/error.tsx`, `app/app/error.tsx` and `app/global-error.tsx` show
  what happened, a reference, the version, and a way back.

## 6. Alerts

An alert exists to prevent a problem within the shift. Each one MUST:

1. Name the condition and the booking or room it concerns.
2. Link to the screen where it is fixed, and offer the fix inline where it is one action.
3. Resolve itself when the condition clears. Staff never dismiss a problem that still exists.
4. Carry a severity. Only **critical** alerts may interrupt, meaning a toast or an email. The rest
   wait in the bell.
5. Belong to a person. Reading an alert clears it for that person only.

The rules, and what raises each alert, arrive in UX-3.

## 7. Learnability and help

- Every screen has a help entry (`?`) that opens the help for that screen (UX-5).
- A field whose meaning is not obvious carries a hint. Examples: Bill To, the rate types, the hold
  types.
- Every core task ships with its help article in the same sprint. Every front-desk procedure also
  ships with a practice drill once the practice hotel exists (UX-5).
- Shortcuts are listed in-app (`?` cheat-sheet, UX-2), and never exist only in a tooltip.
- Support is reachable from the Help menu: WhatsApp and an email form. The message is pre-filled
  with the page, the property, the version and the last error reference.

## 8. Speed and reliability

| Budget                                                                        | Target                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Feedback on any press                                                         | < 100 ms (a pressed state, a spinner or an optimistic change)      |
| Hot reads (`/stayview`, `/room-view`, `/reservations`, `/reservation-config`) | p95 < 400 ms on demo data                                          |
| A list's first rows                                                           | < 1 s after navigation, behind a skeleton                          |
| Background refresh                                                            | never a full-screen reload; never more often than the data changes |

- **`GET /health`** checks the database, the worker's heartbeat and the channel outbox.
  - Plain `/health` answers 200 while the database is up, because deploys use it.
  - `?strict=1` answers 503 on anything degraded, for uptime monitoring.
- **Night audit, deploys and backups never take the product offline.**

## 9. Mobile and touch

- **Touch targets:** at least 44 × 44 px on any surface a phone uses.
- **No hover-only information.** Every tooltip-only icon also has a visible legend on touch.
- **Housekeeping and managers' views** are built for a phone first.
- **Test coverage:** each such screen has a Playwright test at a phone viewport.

## 10. Measurement

What we measure, so the claim "easiest PMS to learn" can be checked:

| Measure                  | How                                                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task time and clicks** | `lib/ux.ts`: `useUxTask()` / `startTask()` record a task key, its duration, its clicks and how many fields were typed into. Every core task is instrumented in the sprint that builds or rebuilds it.           |
| **Mistake signals**      | Read from the records themselves: charges voided within 10 minutes, bookings cancelled within 5 minutes of creation, invoices credited within a day.                                                            |
| **Pulse survey**         | The report's own statements, 1–5, at most once a quarter per person, never in the first two weeks, and never within two weeks of "Not now". The staff scoreboard shows each score beside the industry baseline. |
| **Crashes**              | Every error-screen render counts, by route.                                                                                                                                                                     |

**Privacy is absolute.**

- No guest data is ever collected: no names, references, amounts, rooms, or anything typed.
- Routes are stored as patterns (`/app/invoices/[id]`).
- Events are kept 180 days, then deleted by the worker.
- Only YoHo staff can read the scoreboard, at `/staff`.

## 11. Enforcement — before any screen ships

- [ ] `pnpm --filter @yohobed/web-extranet e2e` is green, including `budgets.spec.ts`. A budget
      this sprint promised has moved from `fixme` to a real test.
- [ ] The DESIGN-SYSTEM.md §9 greps are clean.
- [ ] `pnpm --filter @yohobed/web-extranet ux-lint` passes (it runs in CI; see below).
- [ ] Every new core task is instrumented (`useUxTask`) and has its help article.
- [ ] Every new server action that reverses money or inventory records user and reason and has an
      API e2e test.
- [ ] Any new setting that differs by hotel is a property setting.

The UX lint (`apps/web-extranet/scripts/ux-lint.mjs`) bans three patterns in `app/` and
`components/`:

| Pattern                      | Why                                                     |
| ---------------------------- | ------------------------------------------------------- |
| `window.confirm`             | Use `ConfirmDialog`, which states the consequence (§5). |
| a bare `'Validation failed'` | Say what is wrong and where (§5).                       |
| `.catch(() => {})`           | A failure the person never hears about (§5).            |

Code from before this standard is listed in the script's `KNOWN_DEBT`. The check is a ratchet: a
new offence fails it, and so does fixing an offence without lowering its count. The list only ever
shrinks.
