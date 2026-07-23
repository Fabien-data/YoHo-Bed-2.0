# Deals — Feature Guide

> One screen for all your commercial levers: promotions that discount the rate calendar, coupon codes guests redeem at booking, and referral partners who earn commission on the bookings they bring.

## What this section does

**Deals & codes** has three blocks, top to bottom.

**Promotions** are per-property. Pick a property from the dropdown (Cinnamon Lakeside or Ceylon Tax Villa in the demo), then create a promotion with a name, discount percentage, date window and minimum nights. The demo ships with **"Getaway Deal −15%"**. Each promotion in the list has two buttons: **Apply to calendar** — which pushes the discount onto the property's rate calendar for the promotion's date range and reports back how many rate rows were updated — and **Delete**.

**Coupons** are guest-facing codes redeemed at booking time. Create one with a code (auto-uppercased), a type — **Percentage** off or **Fixed (Rs)** off — a value, a validity window, and an optional max-uses cap (0 = unlimited). The demo includes **SUMMER10** (10% off, any property) and **FAMILY5000** (Rs 5,000 fixed, Cinnamon Lakeside only). Each coupon row shows its usage count, e.g. "used 1/50". Aisha Rahman's demo booking redeemed SUMMER10 for −10%.

**Referral partners** are agents or tour operators who bring you bookings under a code. Add one with a name, code and commission percentage. The demo partner **ISLAND** earns **5%** — Chen Wei's booking came through it. Beside the partner list, the **Earned commissions** panel shows every commission recorded so far: partner, booking reference, amount, and a pending/paid status pill.

Green and red banners at the top of the page confirm each action or explain what went wrong.

## How it works behind the scenes

This screen owns the setup (create/list/delete); the actual redemption happens at booking time inside the booking engine. When a guest books with a coupon code, the system validates it there: the code must exist, today must fall inside its start/end window, its usage must be under the max-uses cap, and if the coupon is scoped to one property (like FAMILY5000) the booking must be at that property. A valid coupon discounts the booking and increments the usage counter you see here. Likewise, a booking made under a referral code automatically records a commission row (booking amount × partner %), which is what feeds the Earned commissions panel — and the same figure Chen Wei's ISLAND booking produced.

**Apply to calendar** is a real bulk write, not a label: the system finds every occupancy of the property, then stamps the promotion's discount percentage onto each rate-calendar row inside the promotion's date range. Each affected occupancy also emits a rate-update event to the (simulated) channel manager queue, so OTAs would be told about the new discounted rates. That is why Nadeesha Silva's demo stay lands on discounted, taxed rates.

Coupon and partner codes are unique — creating a duplicate code is rejected with a clear error. Everything runs under row-level security, so your promotions, coupons and partners are isolated to your own tenant at the database layer.

## What to try

1. Open the **Getaway Deal −15%** promotion and hit **Apply to calendar** — the banner should report how many rate rows were updated; then peek at the Rates calendar to see the discount land.
2. Create a new coupon (e.g. `TEST20`, 20% off, valid from today), then make a booking that redeems it and watch its **used** count tick up here.
3. Try creating a second coupon called `SUMMER10` — it should be rejected as a duplicate code.
4. Make a booking under the **ISLAND** referral code and confirm a new 5% commission row appears in **Earned commissions** with the booking reference.
5. Create your own referral partner (e.g. LANKA at 7%), then delete it again.
6. Create a promotion with a past date window and apply it — expect zero rate rows updated.

## Known limitations in this test build

- Emails are console-logged on the server — no real email delivery.
- The channel manager is simulated; rate-push events are queued but no live OTA is updated.
- No real payment gateway — payments are recorded manually.
- Referral commission payouts are tracked as pending/paid statuses only; no money moves.
- The demo dataset is reset periodically (announced), and this is a shared demo tenant — other testers may add or delete deals too.

## Found something? Tell us

Use the feedback form at the bottom of this page — pick a Type (Bug / Change request / Feature idea) and a Severity, then describe **what you tried**, **what you expected**, and **what happened**, with a screenshot if possible. Every submission lands in our triage board and shapes the next build.
