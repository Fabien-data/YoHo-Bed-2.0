# Dashboard — Feature Guide

> The front-desk morning screen: today's arrivals and departures, who is in-house, what needs approving, tonight's occupancy, and how the month is doing.

## What this section does

The Dashboard (the first screen after you log in) is built for the start of a hotel day. At the top you'll find six tiles: **Arrivals**, **Departures**, **In-house**, **Pending**, **Occupancy** (occupied rooms out of total rooms tonight), and **this month's revenue** with room-nights confirmed.

Below the tiles are two working lists. **Arrivals** shows everyone due to arrive on the selected date — with a **Check in** button next to guests who haven't arrived yet. **Departures** shows everyone leaving that day — with a **Check out** button for guests still in-house. A **Recent bookings** table at the bottom shows the last five bookings with reference, guest, dates, room, status, and amount.

Two controls at the top let you change the view: a **property selector** (All properties, Cinnamon Lakeside, or Ceylon Tax Villa) and a **date picker**, which defaults to today. When there are bookings waiting for approval, a banner appears — "N bookings waiting for approval" — that jumps you straight to the Bookings page.

With the demo data (13 bookings across the two properties, all dated relative to today), you should see **Kasun Jayawardena** in today's Arrivals (marked "Due"), **Sofia Marchetti** in today's Departures (marked "In-house"), **Emma Whitfield** counted under In-house, and the pending requests from **Dinesh Fernando** and **Priya Sharma** in the Pending tile.

## How it works behind the scenes

Every number on this screen is computed live from the bookings database, not cached. Arrivals are bookings whose check-in date equals the selected date (in Approved or CheckedIn status); departures mirror that for the check-out date. Occupancy counts confirmed rooms actually staying the selected night divided by the property's physical room count. Monthly revenue is summed **night by night** from each booking's per-night price snapshot, so a stay that spans two months lands in the right month — the same day-level records used for owner settlement.

The Check in / Check out buttons call the same guarded booking lifecycle used everywhere else: a booking moves Pending → Approved → CheckedIn → CheckedOut, and the server refuses out-of-order moves (you cannot check in a Pending booking, for example). Checking a guest out also mints a single-use review invitation and queues a review-request email to the guest. Every query runs inside the demo hotel group's tenant boundary, enforced by row-level security in the database (each tenant can only ever see its own rows).

## What to try

1. **Check out Sofia Marchetti** — she departs today. Click Check out in the Departures list and watch the Departures hint and In-house tile update.
2. **Check in Kasun Jayawardena** — he arrives today. After clicking Check in, his pill changes from "Due" to "In-house" and the In-house count rises.
3. **Filter by property** — switch between All properties, Cinnamon Lakeside, and Ceylon Tax Villa and confirm the tiles and lists change accordingly.
4. **Move the date** — pick tomorrow or yesterday in the date picker and see arrivals/departures for that day.
5. **Follow the pending banner** — with Dinesh Fernando and Priya Sharma pending, the amber banner should read "2 bookings waiting for approval"; clicking it opens Bookings.
6. **Try an invalid action** — refresh after checking someone out and confirm no second Check out button appears for them.

## Known limitations in this test build

- Guest emails (confirmations, review invites) are logged on the server console, not actually delivered — testers will not receive real email.
- The channel manager is a simulated provider; no live OTA connection exists in this build.
- The demo dataset is periodically reset (resets are announced), so your changes will not survive forever.
- All testers share one demo hotel group tenant — you may see changes made by other testers.

## Found something? Tell us

Use the feedback form at the bottom of this page. Pick a Type (Bug / Change request / Feature idea) and a Severity, then describe What you tried, What you expected, and What happened — a screenshot helps enormously. Every submission lands in our triage board and directly shapes the next build.
