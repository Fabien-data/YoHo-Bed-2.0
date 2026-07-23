# Comms — Feature Guide

> Edit the emails your guests receive, see every message the system has sent, and keep an eye on in-app notifications.

## What this section does

**Comms** is the guest-communication centre. It has two parts on screen, plus the notification bell that lives at the top of the sidebar:

- **Templates** — the wording of the emails the system sends automatically: _booking confirmed_ (`booking_created`), _booking approved_ (`booking_approved`), and the _review invitation_ (`review_invite`). Templates exist per language — English is the default, with Sinhala available and Tamil supported — and you can edit the subject and body of each. Placeholders like `{{guestName}}`, `{{reference}}`, `{{amount}}`, `{{checkin}}`, `{{checkout}}` and `{{nights}}` are filled in with real booking details at send time; click a placeholder chip to append it to the body.
- **Outbound messages** — a log of every email the system has generated, newest first. Each row shows its status (**queued**, **sent**, or **failed**), subject, recipient address, channel, language, and time. Click a row to expand the exact message body that was rendered for that guest.
- **Notifications** — the bell (top of the sidebar) shows an unread count of in-app alerts, such as new bookings. You can mark one or all as read.

## How it works behind the scenes

When a booking is created — by you, or imported from an OTA — the system renders the right template with that booking's details and writes the message into the log **in the same database transaction as the booking itself**. Only after the booking is safely saved does a mailer pass the queued messages to the email provider. A provider problem marks the message **failed** in the log, but it can never break the booking — you'd see the failure here rather than losing the reservation.

The same "record first, send after" idea protects your rates and availability. Every rate, availability, or booking change is written to a **transactional outbox** alongside the change itself, then a background worker picks it up and pushes it to the channel manager (which relays to OTAs like Booking.com). Failed pushes are **retried automatically with increasing delays**; a push that keeps failing is parked and raises a loud alert instead of vanishing silently. In this test build the channel manager is **simulated**, so pushes succeed instantly without touching real OTA channels.

## What to try

1. **Edit a template.** Open _Templates_, select `booking_created` (EN), reword the subject — e.g. add "Cinnamon Lakeside" — and save. Use the placeholder chips to insert `{{nights}}` into the body.
2. **Trigger a real message.** Go to _Bookings_ and create a walk-in booking for the Deluxe Room with a guest email address. Return to Comms — a new row should appear in _Outbound messages_ using your edited wording.
3. **Inspect a rendered message.** Click any row in the log and check the expanded body: placeholders should be replaced with the actual guest name, reference, dates and amount — no raw `{{...}}` left behind.
4. **Compare languages.** Select the Sinhala (SI) `booking_created` template and confirm it's independently editable from the English one.
5. **Check the bell.** After creating a booking, open the notification bell in the sidebar — mark one notification read, then _mark all read_, and confirm the unread count updates.
6. **Watch a booking with no email.** Create a booking without a guest email address, then check how the message log reports it.

## Known limitations in this test build

- **Emails are not really sent** — the test build uses a console email provider, so messages are rendered and logged (status _sent_) but no guest inbox ever receives them. The log is the source of truth.
- **The channel manager is simulated** — outbox pushes go to a fake adapter, not to live OTAs.
- **Shared demo tenant** — other testers see and edit the same templates and log.
- **Announced resets** — demo data (including template edits) may be reset with notice.

## Found something? Tell us

Use the feedback form at the bottom of this Notion page: choose a **Type** (Bug / Change / Feature idea) and **Severity**, describe **what you tried, what you expected, and what actually happened**, and attach a **screenshot** if you can. Everything goes to one triage board that shapes the next development phase.
