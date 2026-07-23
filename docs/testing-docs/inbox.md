# Inbox — Feature Guide

> The OTA reservation inbox: bookings pushed by the channel manager land here, import automatically as real bookings, and failures stay visible with a one-click Retry.

## What this section does

The Inbox is where reservations from online travel agencies (booking.com, agoda, expedia and friends) arrive via the channel manager. The **Incoming reservations** table shows each one with a status pill — **imported** (green: it became a booking), **failed** (red: something blocked the import, with the exact error printed under the pill), **received**, **cancelled**, or **ignored** — plus the channel, the OTA's own reference, guest, stay dates, the OTA amount, and when it was received. Failed rows carry a **Retry** button so nothing is ever silently dropped: fix the cause, retry, done.

The demo data ships with three OTA arrivals: a **booking.com** and an **agoda** reservation that imported cleanly (you'll find them in the Bookings list as auto-approved OTA bookings), and an **expedia** reservation for a far-out stay that **failed because no rates were set for those dates** — left there deliberately so you can fix it and demonstrate Retry.

Two more panels round out the page. **Simulate an incoming reservation** fires the very same webhook a real channel manager would call — enter a guest name and dates and press "Send OTA reservation" to watch a booking materialise (or fail honestly). **Channel-manager room codes** maps each room to the code the channel manager uses (e.g. CM-DLX-001); a reservation for an unmapped code is rejected back to the channel for retry.

## How it works behind the scenes

An incoming reservation is first written to the inbox exactly as received, then imported through the **same booking pipeline as a walk-in**: the stay is priced from the rate calendar for the mapped room's occupancy, taxes are decomposed out of the charged price, and inventory is reserved atomically across all nights in one transaction — an OTA booking can no more oversell than a front-desk one. Because the guest already paid the OTA, imports are **auto-approved**, skipping the Pending step, and the audit trail records "auto: confirmed by <channel>".

A successful import fires an in-app notification ("New OTA booking … via …") and queues a templated guest confirmation email, and the same transaction enqueues a channel-manager outbox event so availability is synced back out. If anything fails — no room mapping, no rates for the dates, no availability — the transaction rolls back completely, the inbox row flips to **failed** with the real error message, and Retry re-runs the import from scratch. All rows are tenant-isolated by row-level security (the database only ever serves the demo group's own data), and booking references are generated collision-safely.

## What to try

1. **Retry the failed expedia reservation as-is** — it should fail again with the same "no rates" error, proving errors are honest and repeatable.
2. **Fix it, then Retry**: open the Calendar, set a base price covering the expedia stay's far-out dates, come back, press Retry — it should import and report the new booking reference.
3. **Simulate a reservation** for a guest of your choosing arriving next week; confirm it appears as **imported** here and as an auto-approved OTA booking in Bookings, with a notification in the bell.
4. **Simulate a failure**: close out a date range on the Calendar (or zero its rooms), then simulate a reservation for those dates and read the availability error on the failed row.
5. **Check the audit trail** — find the imported booking in Bookings and confirm its history shows creation plus an automatic approval naming the channel.

## Known limitations in this test build

- The channel manager is a **simulated** provider — the "Simulate" panel stands in for real OTA traffic; no live booking.com/agoda/expedia connection exists yet.
- Guest confirmation emails triggered by imports are console-logged on the server, never actually delivered.
- The demo dataset resets periodically (announced), restoring the original inbox including the failed expedia row.
- All testers share one demo hotel group, so someone may retry "your" failed reservation before you do.

## Found something? Tell us

Use the feedback form at the bottom of this page. Choose a Type (Bug / Change request / Feature idea) and a Severity, then describe What you tried, What you expected, and What happened — screenshots of error rows are especially helpful here. Every submission lands in our triage board and shapes the next build.
