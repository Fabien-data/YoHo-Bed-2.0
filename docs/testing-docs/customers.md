# Customers — Feature Guide

> A guest directory (CRM) that shows every guest you have ever hosted, with their full booking history and lifetime value.

## What this section does

Open **Customers** from the sidebar and you will see a table of every guest across your properties — the demo tenant covers **Cinnamon Lakeside** and **Ceylon Tax Villa**, with 13 demo bookings spread across guests like Ruwan Perera, Tharindu Fernando, Chen Wei, Aisha Rahman and Nadeesha Silva. (Demo dates always sit relative to "today", so the data stays fresh whenever you log in.)

At the top you get two quick counts: total guests, and how many are **repeat** guests (more than one booking). Each row shows the guest's name, contact details (email and phone), number of bookings, total nights stayed, **total value** (their confirmed spend with you), and their most recent check-in date. Guests with more than one booking carry a "repeat" badge — your regulars at a glance.

Click any row and it expands to show that guest's full stay history: booking reference, status pill (Approved, CheckedIn, CheckedOut, Pending, Cancelled and so on), the check-in → check-out dates, nights and rooms, the amount, and the source channel the booking came through. Ruwan Perera, for example, shows a checked-out stay; Chen Wei's booking arrived via the referral partner ISLAND; Aisha Rahman's booking used the SUMMER10 coupon.

This screen is read-only — guests are created automatically when bookings are made, so there is nothing to fill in here.

## How it works behind the scenes

The customer list is a live roll-up computed from the bookings table, not a separately maintained spreadsheet. For each guest the system counts their bookings, sums their **nights** (excluding Cancelled and Rejected bookings, which never happened), and sums their **total value** counting only confirmed revenue — bookings in Approved, CheckedIn or CheckedOut status. Pending and cancelled bookings therefore appear in the history but do not inflate the guest's spend. The "last check-in" column is simply the latest check-in date across their bookings.

When you expand a guest, the app fetches that guest's detail record on demand: the customer profile plus every booking linked to them, newest first. Nothing is cached stale — what you see reflects the database at that moment.

All queries run inside your tenant's row-level-security context, meaning the database itself guarantees you can only ever see guests and bookings belonging to your own account, even on shared infrastructure.

## What to try

1. Find **Ruwan Perera** and confirm his row shows a checked-out stay and a non-zero total value — his invoice was paid in full by VISA.
2. Expand **Chen Wei** and check the stay history shows the booking that came in via the ISLAND referral partner, with its reference and source visible.
3. Compare **Tharindu Fernando's** total value here against his invoice in Finance — the customer roll-up shows the booking amount, while the invoice tracks how much has actually been paid (currently a 50% advance).
4. Create a brand-new booking from the Bookings section for an existing guest name and email, then return here — the guest should gain a booking, and if it is their second, the "repeat" badge should appear.
5. Cancel a Pending booking and confirm the guest's **nights** and **total value** do not include it, although the cancelled stay still shows in their expanded history.

## Known limitations in this test build

- Emails (booking confirmations, check-out mails) are console-logged on the server — no real email is delivered to guest addresses.
- The channel manager connection is simulated; OTA-sourced bookings are demo data.
- There is no real payment gateway — payments are recorded manually in Finance.
- The demo dataset is reset periodically; resets are announced in advance.
- You are working in a shared demo tenant, so other testers' changes may appear alongside yours.

## Found something? Tell us

Use the feedback form at the bottom of this page — pick a Type (Bug / Change request / Feature idea) and a Severity, then describe **what you tried**, **what you expected**, and **what happened**, attaching a screenshot if you can. Every submission lands straight in our triage board and shapes the next build.
