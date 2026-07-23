# Bookings — Feature Guide

> The reservations desk: every booking in one list, with walk-in creation, approvals, check-in/out, no-shows, cancellations, and full editing.

## What this section does

The Bookings page lists all reservations for the hotel group — 13 demo bookings across **Cinnamon Lakeside** and **Ceylon Tax Villa**, all dated relative to today. Each row shows the booking reference, guest, stay dates and nights, source (Extranet or OTA), a colour-coded status, and the amount. Filter chips across the top (**All, Pending, Approved, CheckedIn, CheckedOut, Rejected, Cancelled, NoShow**) show live counts, and a search box matches guest name or reference.

Each row offers exactly the actions its status allows: **Approve/Reject** for Pending bookings, **Check in / No-show / Cancel** for Approved, **Check out** for CheckedIn, and **Edit** for any live booking. The Edit dialog lets you change guest details any time, and additionally move dates or change the room count while the booking is still Pending or Approved — the stay is re-priced and re-totalled automatically.

The **+ Walk-in booking** button opens a form: pick a room and occupancy (guest configuration), enter the guest's name and optional email/phone, choose dates and room count, and optionally apply a coupon (**SUMMER10** for 10% off, **FAMILY5000** for a flat discount) or a referral code (**ISLAND**, the demo travel-agent partner). In the demo data you'll find **Ruwan Perera** (checked out, left a 5★ review), **Emma Whitfield** (in-house), **Sofia Marchetti** (departs today), **Kasun Jayawardena** (arrives today), and pending requests from **Dinesh Fernando** and **Priya Sharma**.

## How it works behind the scenes

When a booking is created, each night is priced from the **rate calendar** for the exact occupancy chosen — the same parity-tested engine that powers the Calendar page — with any last-minute drop applied. Tax is then decomposed _out of_ the charged price per night, so every booking stores its amount, base total, taxes, and the commissionable amount separately, and a per-night price snapshot is kept for settlement.

Inventory is reserved **atomically**: all nights of the stay are decremented in one database transaction, and if even one night lacks availability the whole booking is refused ("No availability for those dates") — overselling is structurally impossible. The same transaction queues a channel-manager outbox event so OTAs are told about the inventory change; rejecting or cancelling releases the nights and queues the reverse event. Editing a stay swaps inventory atomically too: old nights are released and new ones reserved in one transaction that rolls back entirely if the new dates don't fit.

The lifecycle is guarded — Pending → Approved → CheckedIn → CheckedOut, with Reject/Cancel/No-show only where they make sense — and every transition is written to an audit trail. Booking references are generated collision-safely, min/max-stay rules are enforced on the arrival date, coupons are validated (active, in date, usage limit, right property) and their redemptions recorded, referral bookings accrue partner commission on the commissionable amount, and each creation fires an in-app notification plus a templated guest confirmation email. Check-out mints a single-use review invite link. All of it sits behind row-level security, so testers only ever see the demo tenant's data.

## What to try

1. **Approve Dinesh Fernando's pending booking**, then check the notification bell — a "New booking" style notification trail exists for every booking event.
2. **Reject Priya Sharma's pending booking** and confirm her nights are freed (the Calendar's rooms-to-sell for those dates goes up).
3. **Create a walk-in with coupon SUMMER10** and verify the confirmation shows a reference and total; try an invalid code and read the error.
4. **Try to oversell**: create a walk-in for more rooms than the Calendar shows available on a date — you should get "No availability for those dates."
5. **Edit an Approved booking's dates** and watch the success message report the new re-priced total.
6. **Try a wrong-order action** — the buttons prevent it, but note that a checked-out booking only offers Edit (guest details only).

## Known limitations in this test build

- Guest confirmation and review-invite emails are console-logged on the server — testers will not receive real email.
- The channel manager is simulated; outbox events are processed by a fake provider, not a live OTA.
- The demo dataset resets periodically (announced), restoring the original 13 bookings.
- All testers share one demo hotel group, so bookings may change under you as others test.

## Found something? Tell us

Use the feedback form at the bottom of this page. Pick a Type (Bug / Change request / Feature idea) and a Severity, describe What you tried, What you expected, and What happened, and attach a screenshot if possible. Every submission lands in our triage board and shapes the next build.
