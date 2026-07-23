# Finance — Feature Guide

> Your money view: monthly revenue by booking status, plus a payout statement that splits every rupee of guest spend into what the property keeps, what YoHo and the OTA earn, and taxes — and proves it reconciles.

## What this section does

The **Finance** screen is built around a month. Use the ◀ ▶ arrows or the month picker to move between months (it opens on the current month), and the property dropdown on the right to switch between **Cinnamon Lakeside** and **Ceylon Tax Villa**.

The left card is **Revenue** for the chosen month across all your properties: a headline figure of confirmed (approved and beyond) gross revenue, pills breaking bookings down by status — Approved, Pending, CheckedOut and so on — and the total number of bookings checking in that month. The 13 demo bookings sit in the current window, so you should see money here on day one.

The right card is the **Payout statement** for the selected property: the headline **net payable** (what the property is owed), then a line-by-line split — **Gross selling**, **Property base**, **Yoho commission**, **OTA commission**, and **Taxes**. Underneath, a live reconciliation check adds base + yoho + ota + taxes back together and shows a green tick when it equals the gross (it should, always, to the cent).

The two demo properties are deliberately different: Cinnamon Lakeside uses a **percentage** commission and is untaxed, so its Taxes line is zero; Ceylon Tax Villa uses **slab** commission plus a **10% service charge and 15% VAT**, so its statement carries a real Taxes figure — Nadeesha Silva's stay on last-minute-dropped, taxed rates flows through here. A payout snapshot for Cinnamon Lakeside is also pre-seeded in the demo data.

## How it works behind the scenes

Every approved booking's tax-inclusive total is decomposed by the domain pricing engine: taxes are reverse-divided out first (nested service-charge → VAT division, mirroring parity pricing), leaving a commissionable total; the property is paid its **base rate**, YoHo keeps its stored commission, and whatever margin remains is the OTA's cut. By construction, base + yoho + ota + taxes always reconciles back to the gross — that is what the green tick verifies. Commission itself comes in two models: **percentage** (the base is grossed up by the YoHo percentage) and **slab** (a lookup table maps each base-price band to a fixed commission amount).

The statement counts bookings in Approved, CheckedIn or CheckedOut status whose check-in falls in the period — cancelled and pending bookings never touch payouts. Behind the same engine sit **invoices** and **payments**: invoicing a booking is idempotent (asking twice returns the same invoice, numbered `INV-<booking reference>`, with one line per room-night), payments are recorded as received or refunded with a method and reference, and once received payments cover the invoice amount, the invoice automatically flips to **paid**. That is why Ruwan Perera's invoice shows PAID (settled in full via VISA) while Tharindu Fernando's is still open on a 50% advance. All of it runs under row-level security — the database itself walls each tenant's financial data off from every other tenant.

## What to try

1. On the current month, check the payout statement for **Cinnamon Lakeside** shows Taxes = 0 and a green reconciliation tick.
2. Switch to **Ceylon Tax Villa** and confirm a non-zero Taxes line — and that the split still reconciles to gross to the cent.
3. Step back a month, then forward two — cards should refresh each time, and empty months should say so rather than showing stale numbers.
4. Create and approve a new booking for this month in the Bookings section, then return here — approved revenue and the payout statement should both grow.
5. Cancel a pending booking and confirm the revenue pills change but the payout figures do not (pending was never in them).
6. Compare the Revenue headline against the statuses: only Approved, CheckedIn and CheckedOut bookings should count toward the headline figure.

## Known limitations in this test build

- Invoices, payments and payout snapshots exist in the backend (and in demo data like Ruwan's paid invoice), but there is no screen to create or record them yet — this Finance page is read-only.
- Emails are console-logged on the server; nothing is actually sent.
- No real payment gateway — all payments are recorded manually.
- The channel manager is simulated.
- Demo dataset resets are announced; this is a shared demo tenant, so figures move as other testers create bookings.

## Found something? Tell us

Use the feedback form at the bottom of this page — pick a Type (Bug / Change request / Feature idea) and a Severity, then describe **what you tried**, **what you expected**, and **what happened**, with a screenshot if possible. Every submission lands in our triage board and shapes the next build.
