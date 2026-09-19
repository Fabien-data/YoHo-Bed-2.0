# YoHoBed Extranet — Hotel Owner's Guide

Welcome! This guide walks you through everything you can do in the YoHoBed Extranet — from
registering your property to taking bookings, running your front desk, connecting your OTA
channel, and getting paid. No technical knowledge needed.

> **Your daily routine at a glance**
>
> 1. Open **Dashboard** — see today's arrivals, departures, and anything waiting for approval.
> 2. **Check in** arriving guests and **check out** departing ones, right from the Dashboard.
> 3. Glance at the **Inbox** — OTA reservations import themselves; only red "failed" rows need you.
> 4. Approve any **Pending** bookings (Dashboard shows a shortcut when there are any).
> 5. Keep the **Calendar** honest: prices set, rooms open, dates you can't sell closed.
>
> That's it. Everything else — guest emails, review invites, channel sync — happens
> automatically.

---

## 1. Getting started

### Creating your account

1. On the sign-in page, choose **Create an account**.
2. Enter your name, your property/business name, your email, and a password (at least 8
   characters). Registration is free.
3. You'll see **"Registration received."** You can sign in immediately — no waiting.

### The approval banner

While your account awaits review, an amber banner sits at the top of every page:
_"Your account is awaiting approval."_ You can set up **everything** during this time — property,
rooms, prices, photos, templates. Once the YoHoBed team activates your account you'll receive a
welcome email, the banner disappears, and you're fully live.

### Signing in, signing out, passwords

- Sign in at the home page with your email and password.
- **Forgot password** emails you a reset link valid for 60 minutes.
- Change your password anytime in **Profile → Change password**.
- **Sign out** is at the bottom of the left sidebar.

### Finding your way around

Everything lives in the fixed left sidebar: **Dashboard, Calendar, Bookings, Inbox, Customers,
Deals, Finance, Reviews, Comms, Setup, Profile**. The bell at the top shows notifications (new
bookings, OTA imports, new reviews) — click one to mark it read. The interface follows your
device's light/dark setting automatically.

---

## 2. Set up your property (Setup tab)

Your inventory has a simple hierarchy — set it up top-down, once:

**Property → Rooms → Meal plans → Occupancies**

1. **Property** — add your property by name. Add photos (JPEG/PNG/WebP, up to 5 MB each) —
   click **+ Add photo**; hover a thumbnail and click × to remove it.
2. **Rooms** — add each room type you sell (e.g. "Deluxe Room") with its **quantity** — how many
   physical rooms of that type exist. Quantity is your overbooking ceiling: the system will
   never let you sell more than this on any night. Rooms can have photos too.
3. **Meal plans (rate plans)** — for each room, add the meal plans you offer: RO (room only),
   BB (bed & breakfast), HB (half board), FB (full board), AI (all-inclusive).
4. **Occupancies** — for each meal plan, add guest configurations, e.g. "Double (×2)",
   "Triple (×3)". **Prices are set per occupancy** — a double and a triple can have different
   rates for the same room.

> Commission model and taxes (service charge/VAT) are configured for your property by the
> YoHoBed team. You'll see their effect transparently in the Finance screen.

---

## 3. Prices & availability (Calendar tab)

The Calendar is a month-at-a-time wall grid — the heart of the system. Pick your **property**,
**room**, and **occupancy** at the top, and move between months with ◀ ▶ or the month picker.

### What a day cell shows

- A status badge: **Open** (green), **Low** (amber, 2 or fewer left), **Sold out**, or
  **Closed**.
- The **selling price** for that night. If a last-minute discount applies, the original price is
  struck through with a red −% badge.
- **Rooms to sell / physical quantity** (e.g. `3/5`).

### Editing a single day (click it)

- **Click the price** → type a new **base price**, press Enter. Esc cancels.
- **Click the rooms number** → type how many rooms to sell, then **Open** or **Close** the date.

### You set the base — the system computes the selling price

You never type the price a guest pays. You enter your **base** (what you want to earn per
night), and the engine adds the YoHoBed commission, the OTA share, and any taxes — every cell
shows the final selling price. The **Finance** screen shows you exactly how each rupee splits.

### The bulk toolbar (applies to the whole visible month)

- **Base / night → Set month** — one price across the month.
- **Drop % → Last-minute drop** — a temporary discount off the selling price (e.g. 15%).
- **Rooms to sell → Open / Close** — bulk-open or bulk-close the month.
- **Min stay / Max (0 = ∞) → Restrictions** — arrival-based stay rules. With min 2, a guest
  arriving on those dates must book at least 2 nights; max 7 caps stays at 7. These apply to
  every booking source — walk-ins and OTA alike.

### Change history

Click **Show** under the grid to see every change made to this room — price sets, opens/closes,
drops, restrictions — with dates, the change itself, who made it, and when. Your audit trail.

---

## 4. Bookings & the front desk

### The Dashboard (your morning screen)

Filter by property, pick a date (defaults to today), and you get: **Arrivals** (with one-tap
**Check in**), **Departures** (one-tap **Check out**), **In-house** count, **Pending** approvals
(with a shortcut link), tonight's **occupancy %**, and the month's gross so far, plus the five
most recent bookings.

### A booking's life

```
Pending → Approved → Checked in → Checked out
   ↘ Rejected / Cancelled            ↘ (guest never arrived: No-show)
```

- **A reservation's type decides where it starts** (see _Taking a reservation_ below): a
  **Confirm** booking is confirmed at once, an **Inquiry** holds no room, and a **Hold** keeps the
  rooms until its release time.
- **OTA bookings arrive already Approved** — the guest has already paid the channel.
- **Rejecting or cancelling returns the rooms to your calendar** automatically. A **no-show**
  keeps the night the guest missed (you may charge it) and puts the rest of the stay back on sale.
- **Checking out a guest automatically emails them a review invitation.**

### Taking a reservation (Quick Reservation)

Open it from wherever you are:

- the calendar-plus icon in the top bar, or **Alt+N**;
- **New reservation** in the search palette (**Ctrl+K**), or on the Reservations and Bookings
  screens;
- a **double-click on an empty night in Stay View**, which picks that room and date for you;
- **New reservation in room …** on a vacant room in Room View.

Then fill it in, top to bottom:

1. **Dates.** Type them (`17/09/2026` works, and so does `2026-09-17`) or pick them from the
   calendar. Times take `2pm` or `14:00`. Click the dark **Nights** box to type the number of
   nights instead of a check-out date.
2. **Room(s), type and source.** The **Reservation type** is **Confirm**, **Inquiry** (no room
   is taken yet) or **Hold** (the rooms are kept until the release time you set, then go back on
   sale automatically; you are reminded before). The **Business source** list is searchable.
3. **Rooms.** One row per room: room type (with how many are left), rate type, a specific room
   if you want one, and adults and children. The **Rate** shows what the stay costs for that
   room, taxes included. Type over it to change the price. You then need to give a reason, and
   a discount beyond your limit needs an owner to approve it on the spot.
4. **The guest.** Title, full name, mobile (a local number needs no country code) and email. As
   you type, **returning guests** who match are offered: pick one to link the stay to their
   history.

The **Total** updates as you go and is the amount that will be saved. **Reserve** books every
room together, or none of them. A reservation of several rooms gets references like
`2609180001-1`, `-2`, and they appear together in Reservations. If a room was taken while you
were typing, the form says which one. Pressing **Esc** asks before throwing away what you
entered.

### The full Add Reservation page

**More options** in Quick Reservation carries what you typed to the full page; you can also open
it from the arrow beside **New reservation** on the Reservations screen. Everything Quick
Reservation has is there, plus:

- **Where it came from.** Booking source (Direct, OTA, Travel agent, Corporate) narrows the
  business sources. A travel agent or company booking asks for the account and its voucher
  number; an OTA booking for the OTA's booking ID. Market segment is filled in automatically
  unless you choose one, and you can name the sales person.
- **Rate offered.** **Contract** prices from the account's agreed rates (Pro, once the account has
  some). **Book all available rooms** adds every free room at once. **Quick group booking** asks
  how many of each room type, at which rate type, and optionally one price per room per night.
  **Complimentary room** makes every room free (it needs a reason, and an owner unless your
  property allows staff to give them).
- **Each room's ⌄ menu.** An **inclusion** (breakfast, dinner, a driver's or guide's room: a price
  per night, per guest per night or once, posted to the bill by night audit while the guest is
  in the house — or marked as already in the room rate), a **pick-up or drop-off** (vehicle, time,
  flight, charge — charged when it is marked done), remarks for that room, a **task** for another
  department (Pro) and the children's ages and extra beds. What a room carries shows as small
  chips under it; × takes one off.
- **Group options** (two rooms or more): make every room like room 1, set the guests in every
  room, give out room numbers, paste a **rooming list** from Excel or WhatsApp (one name per line;
  a mobile after the name is kept), or change the group owner.
- **Guest information.** Address, country, state and city, **nationality** — which decides whether
  the guest is sold resident or foreign rates — and the **ID document** you looked at. For an
  Aadhaar card only the last four digits are kept. Tick **Guest list** to give every room its own
  guest; a room left blank is booked for the main guest.
- **Remarks** for the whole reservation, and **Other information** (voucher emails, the check-out
  email, guest portal access, hiding the rate on the registration card).

The **Billing Summary** on the right shows the room charges, each tax, any coupon and the amount
due as you go, and holds:

- **Bill to** — the guest; the **group owner** (one payer for every room); or, with a travel agent
  or company chosen (Pro), **the company for everything**, or **the company for room and tax with
  extras to the guest** (the guest gets a second bill for meals and transfers). At check-out the
  company's bill moves to its city ledger account, and a travel agent's commission is added to
  theirs.
- **Tax exempt** (with the exemption number) and the reason and owner approval when a price is
  changed.
- **Payment mode** — take a deposit or the whole stay now: choose how the guest paid (cash, card,
  bank transfer, LankaQR, wallets …), the amount (**Full** fills in the total), the reference
  number where the method needs one, and a photo or PDF of the slip. Cash goes into your open cash
  drawer; with cashiering, open a drawer shift first. A deposit on several rooms is shared between
  them under one receipt number. **Pay later** takes nothing now. A method in another currency
  (Cash USD) is not offered here yet.

**Reserve** and **Check-in** are at the bottom of the screen all the time. **Check-in** is for a
walk-in: a confirmed stay arriving today is saved and checked in at once, into the first free room
of each type (you are told if that room is marked dirty).

### The Reservations screen

- **Tabs**: Reservations (staying on the date), **Upcoming**, **Booked today**, Arrivals,
  Departures, In-house, Cancelled — each with its count.
- **Filters**: type (confirmed, holds, inquiries, online failed), business source, market
  segment, and **Taken by me**. Search finds a reference (the master reference finds every
  room), a voucher, a name, an email or a phone number.
- **Views**: individual or **groups**, as a list or as **cards**. The icons show adults and
  children; a hold shows when it releases its rooms. **Manage columns** chooses the columns and is
  remembered on this computer. The list pages 25, 50 or 100 at a time.
- **⋮ on a row**: open, confirm, check in or out, assign a room, registration card, release a
  hold, no-show, cancel — whichever apply. Clicking a guest opens the reservation: its money, the
  other guests in the room, inclusions and transfers (**Mark done** charges a transfer; **Cancel**
  takes the charge back), remarks, tasks, ID documents and (Pro) the folio — which shows who each
  bill is for, and every payment with its receipt number and slip.
- **Make group** (select two or more) and, in the group view, **Merge groups** before anyone has
  arrived. Opening a group card lists its rooms.
- **Export** downloads every row of the tab as a spreadsheet file, not just the page on screen.

### Managing bookings

Filter chips (All / Pending / Approved / …) and a search box (guest name or reference) sit above
the table. Each row offers the actions its status allows: **Approve/Reject** when Pending;
**Check in / No-show / Cancel** when Approved; **Check out** when checked in; **Edit** on any
live booking.

**Editing:** guest name/email/phone can change anytime. Dates and room count can change while
Pending or Approved — the system re-prices the new stay from your calendar and swaps the
inventory atomically (it will refuse rather than overbook). Any coupon discount is kept.

---

## 5. OTA reservations (Inbox tab)

When your property is connected to the channel manager, OTA reservations (Booking.com, Expedia,
Agoda…) flow in here — and import themselves as bookings.

### One-time setup: room codes

In **Channel-manager room codes**, give each room the code your channel manager uses for it
(e.g. `CM-DLX-001`) and **Save**. A reservation arriving for an unmapped code is rejected back
to the channel manager to retry — nothing is ever lost silently.

### How imports work

Every incoming reservation is **recorded first, then imported**: your inventory is reserved
atomically, the booking is created **already Approved**, you get a bell notification, and the
guest gets a confirmation email. Duplicates (the same OTA reference pushed twice) are ignored.
OTA **cancellations** cancel the booking and return your rooms automatically.

### When an import fails

If a reservation can't import — no availability, no price loaded for those dates — the row stays
in the Inbox **marked failed, with the reason**. Fix the cause (open the dates, set the price)
and press **Retry**. The row never disappears until it's resolved.

### Simulate

The **Simulate an incoming reservation** card fires a realistic test reservation at your own
system — useful to see the whole flow end-to-end before your channel goes live.

---

## 6. Deals & marketing (Deals tab)

- **Promotions** — a percentage discount for a date window on one property (e.g. "August Heat,
  15%, min 2 nights"). Create it, then press **Apply to calendar** — it paints the discount
  across the month as a last-minute drop; guests see the struck-through price.
- **Coupons** — codes guests (or your front desk) enter when booking: percentage or fixed-Rs,
  valid dates, optional usage cap. Redemptions count automatically.
- **Referral partners** — give an agent or partner a code and a commission %. Every booking
  carrying their code earns them a commission, tracked under **Earned commissions**
  (pending → paid).

---

## 7. Money (Finance tab)

Pick the month (◀ ▶ or the picker) and property.

- **Revenue** — the month's confirmed gross across all your properties, with counts by booking
  status.
- **Payout statement** — for the selected property, the big number is **net payable: what
  YoHoBed owes you**. Below it, the exact split of the gross:

| Line              | Meaning                                                            |
| ----------------- | ------------------------------------------------------------------ |
| Gross selling     | Everything guests were charged                                     |
| **Property base** | **Your money — the base prices you set. This is the net payable.** |
| Yoho commission   | YoHoBed's commission (percentage or slab, per your agreement)      |
| OTA commission    | The booking channel's share                                        |
| Taxes             | Service charge / VAT collected (where configured)                  |

The ✓ line confirms the four parts add up to the gross **to the cent** — if you ever see ⚠,
contact YoHoBed support.

> **Get paid:** enter your bank details in **Profile → Payout account** — bank, branch, account
> holder, account number, SWIFT (optional). Settlements are sent there.

---

## 8. Guest emails & notifications (Comms tab)

Guests automatically receive emails at the right moments — booking confirmation, and a review
invitation after check-out. You control the wording:

- **Templates** — pick a template (per language; English and Sinhala provided), edit the
  **subject** and **body**, and click the placeholder chips — `{{guestName}}`, `{{reference}}`,
  `{{amount}}`, `{{checkin}}`, `{{checkout}}`, `{{nights}}` — to insert live values. **Save.**
- **Outbound messages** — the log of every email: sent, queued, or failed (with the reason).
  Click a row to read exactly what the guest received.
- The **bell** (top of the sidebar) collects your in-app notifications: new bookings, OTA
  imports, new reviews.

---

## 9. Reviews (Reviews tab)

When you check a guest out, they're emailed a **single-use review link** — one rating (1–5
stars) and an optional comment per stay; the link can't be reused. The Reviews screen shows each
property's **average rating** and every review with the guest's name and booking reference.
You'll also get a bell notification for each new review.

---

## 10. Customers (Customers tab)

Every guest you've ever hosted, in one directory: contact details, number of bookings (repeat
guests are flagged), total nights, **total value**, and last check-in. Click a guest to expand
their full stay history. It builds itself from your bookings — guests are recognized by their
email address.

---

## 11. Your account (Profile tab)

- **Your details** — name, email, business, and your account status pill.
- **Platform agreement** — read and **Accept** (covers commission terms, payout schedule,
  cancellation handling). The acceptance date is recorded.
- **Payout account** — where your money goes (see §7).
- **Change password** — current password + new one (min 8 characters).

### Account statuses

| Status                   | Meaning                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| **Pending**              | Just registered — set everything up; the YoHoBed team is reviewing. |
| **Active**               | Fully live.                                                         |
| **Suspended / Inactive** | Sign-in is blocked. Contact YoHoBed support.                        |

---

## 12. Quick answers

- **Why can't I type the guest's price directly?** You set the _base_ (your earnings); the
  system derives the selling price so commission and taxes are always correct and your payout
  always reconciles. See §3 and §7.
- **A guest wants to extend their stay.** Bookings → the booking → **Edit** → change the
  check-out date. It re-prices and checks availability automatically.
- **I need to block dates (renovation, private event).** Calendar → set the range → **Close**
  (bulk toolbar), or click individual days → **Close**.
- **An OTA reservation shows "failed" in the Inbox.** Read the reason on the row, fix it (open
  the dates / set prices), press **Retry**.
- **Where do I see who changed a price?** Calendar → **Change history**.
- **The guest never showed up.** Bookings → the Approved booking → **No-show** (this keeps the
  night in your revenue, unlike Cancel).
