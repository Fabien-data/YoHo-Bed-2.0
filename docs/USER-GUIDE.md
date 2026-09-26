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
Deals, Finance, Reviews, Comms, Property & settings, Profile**. The bell at the top shows notifications (new
bookings, OTA imports, new reviews) — click one to mark it read. The interface follows your
device's light/dark setting automatically.

---

## 2. Set up your property (Configuration)

**Property & settings** in the sidebar opens **Configuration**: one place for the hotel and every
list the desk picks from, laid out the way Yanolja lays it out. Each section has its own page
(its address is `/app/configuration/<section>`, so you can bookmark one). Everyone can read
them; only the owner can change anything.

### Property

- **Hotel profile** — five tabs:
  - **Profile**: logo, name, property type, star rating, emails and phone numbers, website, fax,
    the registration numbers (a main one and four more), the address, and the map. **Locate on
    map** finds the typed address and pins it (latitude and longitude fill in); **Use these
    coordinates** pins numbers you typed. Check-in and check-out times, the timezone, and the
    tax and invoicing numbers are here too.
  - **Highlights**: a few sentences about the hotel and up to ten short highlights.
  - **Amenities**: what the whole hotel offers, ticked from a list.
  - **Photo gallery**: add photos; the first one is the cover. Move a photo earlier or later to
    change the order guests see.
  - **Policies**: cancellation, children, extra beds, pets, smoking and house rules, in your own
    words — they print on the confirmation voucher.
  - **Add a property** (top right) adds another hotel to your account.
- **Room types** — the list shows each type in your own order (drag the handle, or focus it and
  press ↑/↓), whether it is sold (the switch), and its **Base** and **Max** guests (adults /
  children). Open one to edit its **Basic information** (name, short code, guests, beds,
  description, colour), **Amenities**, **Images** and **Rooms** (the numbered rooms of that
  type — add one, or a run like 101–110). A type that has been booked can be switched off, never
  deleted. The desk cannot book more guests into a room than its Max.
- **Rate types** — what you sell: Room only, Bed and breakfast, a honeymoon package. For each:
  a name and a short code, **Does this rate type include meals?** (tick breakfast, lunch, dinner
  or all inclusive — this sets its meal plan), and **Does this rate type include chargeable
  add-ons?** (an airport pick-up or a spa treatment bundled into the price: the booking lists it
  as already paid for). Once a rate type has been booked its meals cannot change — make a new one.
- **Rate plans** — which room type sells under which rate type, to whom (everyone, residents
  only or foreign guests only), with which market segment, and in which **guest configurations**
  (Single ×1, Double ×2 …). Prices are set per guest configuration on the **Rates calendar** —
  **Prices** opens it on that room type. A green dot means priced; amber means no price yet.
- **Taxes** — the taxes on a room night. **Add tax**, or edit one: a new rate starts on the day
  you choose, and every night before it keeps the rate it had. Saving re-prices the calendar from
  that day; stays already booked keep their prices.

### Settings

**Payment** (how guests pay), **Extra charges** (minibar, laundry …), **Discounts** (named
discounts the desk picks on a reservation: a percentage, or an amount off the first room),
**Currency** (your base currency, the currency you view amounts in, and today's exchange rates),
**Transport types**, **Payouts** (why money leaves the till — picked on every expense voucher),
**Meal plans** (which you sell and what you call them), **Remarks** (saved remarks the desk adds
with one click), **Market segments**, **Business sources** (walk-in, phone, **Social Media**, the
OTAs …), **Holidays** (marked on Stay View and the rates calendar; a yearly one repeats every
year), **Reservation types** (what the five types are called and their colours) and **Guest
attributes** (labels such as Repeat guest or Allergy, shown on every stay of that guest).

### Front desk

**Reservation settings** (holds, price authority, check-in and check-out rules, and **Closing the
day**: automatic check-out and the automatic night audit), **Sales persons**, **Document
numbering** and **Email templates** (see section 8).

> **Guided pricing setup** (under the section list) walks you through capacity, child rules,
> meals and minimum rates. The old **Setup** page now opens Room types.

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
- **The day closes by itself.** A guest still checked in after their departure date is checked
  out automatically at the end of that day (any balance stays on their bill, and you are told),
  and their room turns **dirty** — unless it has been cleaned or re-let since. The **night audit**
  runs automatically at 02:00 hotel time. Both are switched and timed under **Configuration →
  Reservation settings → Closing the day**; **Night audit** shows the next run and the log, with
  runs made automatically marked **Automatic**.
- **Online failed** bookings (the guest booked on an OTA but the booking did not come through
  properly) **keep their room** until you confirm or cancel them.
- **VIP** is a status you put on a stay: a crown on every screen, nothing else.

### Taking a reservation (Quick Reservation)

Open it from wherever you are:

- the calendar-plus icon in the top bar, or **Alt+N**;
- **New reservation** in the search palette (**Ctrl+K**), or on the Reservations and Bookings
  screens;
- a **double-click on an empty night in Stay View**, which picks that room and date for you;
- **New reservation in room …** on a vacant room in Room View.

### Room and Floor View

Open **Rooms** from the front desk navigation. Use **Floor | Rooms** beside the title to switch
between a floor plan and cards. The business date, floor, status filter, maintenance overlay, and
selected room stay in place. Choose **Comfortable** or **Compact** in Rooms. The floor plan supplies
an automatic corridor until an Owner or housekeeping supervisor saves a layout. In layout edit mode,
drag room cards and landmarks, then save; a version conflict asks you to reload another user's edits.

Every card shows the front desk state separately from Dirty, Clean, or Inspected housekeeping
condition. Its small indicators identify configured smoking/accessibility/connected-room settings,
arrival or departure, VIP, group and linked bookings, DND, payment due, work orders, Rush Clean,
meal plan, source, planned move, and next reservation when applicable. The guest-requested safety
preference is set explicitly and is visible only to front desk staff. Use the **HK** button on a
card for a quick condition change, or open the card for the reservation, folio, tasks, work orders,
notes, and room actions.

The cleaning queue orders Rush tasks first. Supervisors and Owners can assign attendants, mark
Rush, and approve Inspected after a room is Clean. Attendants see their assigned work on a phone,
tap **Start** and then **Clean**. The system creates stayover and arrival-preparation tasks after
02:00 in the property's local time; checkout makes the departure room Dirty immediately. The
**Mark departures dirty** control handles older departures that need a manual morning reset.

From an occupied room, use reservation actions to check in/out, collect payment, amend the stay,
add inclusions or a new booking, cancel, no-show, void where permitted, unassign before check-in,
or move/exchange rooms. Review the affected room references in the confirmation. A planned move
can be stopped before it takes effect. Void is an Owner correction for an unarrived reservation
with no payment or issued invoice; otherwise use cancellation and the financial correction flow.

**Print reservation voucher** and **Print invoice** open print-ready PDFs. **Send email** and
**Send invoice** show the document and recipients first, then queue a snapshot for delivery. If
there is no issued invoice, review the folio and issue it before sending. Failed deliveries appear
in Communications for retry.

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
  the guest is sold resident or foreign rates — and the **ID document** you looked at. A green
  tick shows when the guest's details (name, phone or email, nationality) and the ID document
  (type and number) are complete; amber means something is still needed. For an Aadhaar card only
  the last four digits are kept. Tick **Guest list** to give every room its own guest; a room left
  blank is booked for the main guest.
- **VIP** — tick it to mark the stay as VIP.
- **Discount** — pick one of your named discounts (Configuration → Discounts). A percentage
  prices every room that much off; an amount comes off the first room's rate. The discount's name
  becomes the price reason, and a discount beyond the desk's limit asks for approval.
- **Remarks** for the whole reservation (your saved remarks are one click away), and **Other
  information** (voucher emails; the check-out email — the standard thank-you or one of your own
  from Email templates; hiding the rate on the registration card).

The **Billing Summary** on the right shows the room charges, each tax, any coupon and the amount
due as you go, and holds:

- **Bill to** — the **Guest**; the **Group owner** (one payer for every room); **Company** (the
  travel agent or company pays everything); or **Room & taxes to TA, extras to guest** (the guest
  gets a second bill for meals and transfers). Choose the account right there. A group booked
  for a company starts billed to the company. At check-out the
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
  takes the charge back), remarks, tasks, ID documents, the voucher and invoices, and (Pro) the
  folio — which shows who each bill is for, and every payment with its receipt number and slip.

### Sending the voucher and the guest's own page

Open a reservation and look for **Voucher and guest page**:

- **Send voucher** shows the email exactly as the guest will get it, already addressed to them and
  to any addresses the reservation asked for. Each address gets its own email. Change the wording
  under Comms → Templates.
- **Create guest link** makes a page the guest can open with no login — their dates, rooms, what is
  paid and still due, and how to reach you. The link is copied for you to paste into WhatsApp or an
  email; **WhatsApp** opens a chat with the message ready. **Close link** shuts the page again: the
  link then says it is no longer valid. A link closes itself 30 days after check-out.
- The guest page never shows their email, phone or ID, and search engines are told to ignore it.

### Invoices

The **Invoices** block on a reservation, and the **Invoice** button on each folio window, issue the
document. In Sri Lanka, a hotel that has entered its **TIN** (Configuration → Hotel profile)
issues a **TAX INVOICE** for everything carrying VAT and a separate **BILL** for anything that does
not — that is what the 2026 gazette requires. Everywhere else it is one **INVOICE**.

- **Pro-forma** quotes the stay before it happens: nights, inclusions and transfers. It is not a tax
  document and has its own numbering.
- A bill is invoiced **once**. An issued invoice is never edited or deleted — if something is wrong,
  open it and press **Credit note**, give the reason, and the bill can be invoiced again.
- Numbering is gap-free per hotel. **Configuration → Document numbering** shows
  the next number of each series, and lets the owner continue the numbering of a system you are
  moving from (forward only).
- **Finance → Invoices & credit notes** lists everything issued; click a number to open or print it.
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

## 8. Guest emails & notifications

Guests receive emails at the right moments — the booking confirmation, the booking voucher, a
thank-you at check-out and a review invitation. You word them under **Configuration → Email
templates**:

- Pick an email on the left. It says **when it is sent**.
- Edit the **subject** and the **message**. The chips below insert a detail filled in for each
  guest — only the details that email is really sent with (the voucher has the rooms, the total,
  what was paid and the balance; the thank-you does not). A detail the email does not have is
  flagged, since it would come out empty.
- The **preview** on the right shows the email as a guest reads it, with sample details.
- **Reset to the starter text** puts a starter email back as it was.
- **Add a check-out email** makes one of your own (a VIP farewell, a corporate thank-you). The
  desk picks it on a reservation under **Other information → Send email at check-out**. Deleting
  it later sends those guests the standard thank-you instead.

The **Comms** screen is the log of every email: sent, queued, or failed (with the reason). Click
a row to read exactly what the guest received. The **bell** (top of the sidebar) collects your
in-app notifications: new bookings, OTA imports, new reviews, and stays checked out
automatically.

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
