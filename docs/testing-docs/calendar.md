# Calendar — Feature Guide

> A wall-style rates-and-availability calendar where you set nightly prices, rooms to sell, open/close dates, last-minute discounts, and stay restrictions — with a full change history.

## What this section does

The Calendar page shows one month at a time as a familiar wall calendar (Monday-first, weekends shaded). At the top you choose a **property** (Cinnamon Lakeside or Ceylon Tax Villa), a **room** within it, and an **occupancy** — a guest configuration under a meal plan, e.g. "RO · Double (×2)". Arrow buttons and a month picker move you through time.

Each day cell shows three things: a colour-coded status chip (**Open**, **Low** when 2 or fewer rooms remain, **Sold out**, or **Closed**), the **selling price** for the chosen occupancy (with the original price struck through and a red "−15%"-style badge when a last-minute drop applies), and **rooms to sell / physical rooms** (e.g. "5/8 rooms"). Click a price to type a new base price (Enter saves, Esc cancels); click the rooms figure to edit inventory inline or hit the small Open/Close buttons.

Above the grid, a **bulk toolbar** applies changes across a date range (or the whole month with one click): set a base price, apply a last-minute drop percentage, open or close a span of nights with a rooms-to-sell figure, or set **min/max stay** rules for arrivals. A **Change history** section at the bottom lists every price, availability, drop, and restriction change with the date range, the detail, who made it, and when.

The demo data pre-loads prices and availability for both properties, including a "Getaway Deal −15%" promotion already painted onto some dates — so you'll see struck-through prices out of the box.

## How it works behind the scenes

You never type a selling price directly. You enter a **base price**, and the parity-tested pricing engine derives the guest-facing price: base → YoHoBed commission (a percentage or slab structure, per property) → an OTA commission gross-up (divide by 0.82 at the standard 18% rate) → a per-day tax gross-up, since tax rates can vary by date. Untaxed properties simply gross up by ×1. A last-minute drop is applied on top of that selling price at charge time.

Every change is written inside one database transaction together with a **channel-manager outbox event**, so a rate or availability push to OTAs is scheduled atomically with the change — it can never be saved locally but lost on the wire. Each change also appends a row to the ARI history log with the acting user's email. Min/max-stay restrictions are enforced **on the arrival date** when a booking is created (matching legacy behaviour), and all data is isolated to the demo tenant by row-level security — the database itself refuses cross-tenant reads.

## What to try

1. **Click a price cell** on any date, type a new base (e.g. 20000), press Enter — the cell should show a _higher_ selling price than your base, because commission and tax are grossed up on top.
2. **Bulk-set a price** across next weekend using the From/To pickers and confirm the toolbar message reports "base → selling" across the right number of nights.
3. **Apply a last-minute drop** of 15% to this week and look for the struck-through original price and red badge in each affected cell.
4. **Close a few dates**, watch them turn red "Closed", then reopen them with a rooms-to-sell figure.
5. **Set a min stay of 3** for arrivals on a chosen date, then go to Bookings and try a 2-night walk-in arriving that date — it should be refused with a clear message.
6. **Open Change history** and verify every action you just took is listed with your email and a timestamp.

## Known limitations in this test build

- The channel manager is a simulated provider — rate/availability pushes are queued and processed, but no real OTA receives them.
- Emails are console-logged on the server; nothing is actually sent to guests.
- The demo dataset is reset periodically (announced in advance), so prices you set will eventually revert.
- All testers share the same demo hotel group, so someone else may change a price you just set.

## Found something? Tell us

Use the feedback form at the bottom of this page. Choose a Type (Bug / Change request / Feature idea) and a Severity, then tell us What you tried, What you expected, and What happened, ideally with a screenshot. Every submission lands in our triage board and shapes the next build.
