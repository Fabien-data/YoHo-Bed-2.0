# Welcome to YoHoBed 2.0 testing

Thank you for helping us test YoHoBed 2.0 — your time and honest feedback directly shape what gets built next.

## What YoHoBed 2.0 is

YoHoBed 2.0 is a ground-up rebuild of our property-management system (PMS) for hotels and villas. It is the screen a property owner or manager lives in every day: an availability-and-rates calendar, a bookings desk with check-in/check-out, an inbox for reservations arriving from online travel agencies (OTAs), guest and travel-agent records, deals, finance (invoices and payout statements), guest reviews, guest communications, property setup, and the owner's own profile.

There are **11 sections** in the left sidebar: **Dashboard, Calendar, Bookings, Inbox, Customers, Deals, Finance, Reviews, Comms, Setup, and Profile**. At the bottom of every section you'll find a **"Feature guide & feedback"** link — it opens a page like this one that explains the section and collects your feedback.

## Getting in

- **Test site:** [https://yova.markui.lk](https://yova.markui.lk)
- **Credentials:** login details are provided to you privately by the YoHoBed team. We never publish passwords on these pages — if you haven't received yours, just ask us.
- Sign in on the landing page and you'll arrive at the Dashboard. Owner and staff logins see different screens; testers normally use an owner login.

## How the demo data works

You are testing against a realistic demo hotel business, not an empty system:

- **Two properties:** _Cinnamon Lakeside_ (with a **Deluxe Room**) and _Ceylon Tax Villa_ (with an **Ocean Suite**).
- **13 realistic bookings** spread around today's date — some already checked out, some in-house right now, some arriving in the coming weeks — so lists, the calendar, and finance all have meaningful data.
- Rooms are open and priced for the weeks ahead (roughly Rs 18,000 weekdays / Rs 25,000 weekends), with a last-minute discount and a minimum-stay rule set on the Deluxe Room, a travel agent, an active deal, invoices, a payout snapshot, guest reviews, and a few OTA reservations already in the Inbox.

**A few things to know while testing:**

- This is a **shared demo tenant** — other testers are working in the same data at the same time. If something changes under you, a colleague may simply have edited it.
- **Data may be reset** from time to time so everyone gets a clean, realistic starting point. We'll always announce a reset in advance; don't store anything here you need to keep.
- Emails and the OTA channel-manager connection are **simulated** in this build — you can act freely without messaging real guests or real booking channels.
- Please don't change passwords on shared demo accounts.

## How to give feedback

Every feature guide page (including this one) has a **feedback form at the bottom**. When something feels wrong, confusing, or missing:

1. Pick a **Type** — _Bug_ (it's broken), _Change_ (it works, but should behave differently), or _Feature idea_ (something new you'd want).
2. Pick a **Severity** so we know how much it hurt.
3. Tell us **what you tried, what you expected, and what actually happened** — three short sentences is perfect.
4. **Attach a screenshot** whenever you can; it saves everyone a round of questions.

Small things count. "This label confused me" is exactly as welcome as a crash report.

## What happens with your feedback

Every submission from every guide page lands on **one triage board** that the YoHoBed team reviews. We group, prioritise, and turn that board into the plan for the **next development phase** — so the issues and ideas you raise here genuinely decide what gets fixed and built first. We'll keep these pages updated as the build evolves.

Happy testing — and thank you again.
