# Reviews — Feature Guide

> Guest reviews collected automatically at check-out through a single-use email link — no guest login required — with per-property star averages for the owner.

## What this section does

**Guest reviews** is your reputation dashboard. At the top, one card per property shows its average rating and review count — with the two seeded demo reviews (**5★ from Ruwan Perera** and **4★ from Ayesha**) you will see averages for the demo properties straight away.

Below the summary cards is the review feed, newest first. Each entry shows the star rating (filled and empty stars), the guest's name, a property badge, the booking reference it belongs to, the date, and the guest's written comment if they left one.

The guest side lives outside the app: when you **check a guest out** in the Bookings section, the system emails them an invitation containing a personal review link. That link opens a small public page showing their name, the property, and their stay dates, where they pick a rating from 1 to 5 and optionally write a comment — no account, no password. Each link works exactly once; revisiting a used link shows that the review was already submitted.

When a review arrives, a notification also lands in your in-app inbox ("New 5★ review for …"), so you hear about it without watching this page.

This screen is read-only in the current build — there is no reply, hide or moderation control yet.

## How it works behind the scenes

Check-out creates a **review invite**: a record carrying the guest's name, the property, the stay dates, and a randomly generated **128-bit token** embedded in the emailed link. That token is deliberately the entire authorization — it is unguessable, it resolves which tenant and booking the review belongs to, and it lets the guest submit without logging in. The invite table is intentionally exempt from row-level security for exactly this reason (the token is the key); everything else — the reviews themselves, notifications, bookings — sits behind tenant row-level security, meaning the database guarantees each hotel account only ever sees its own data.

Submission is **single-use and atomic**: the service checks the invite exists and has not been used, writes the review (rating, comment, guest name) and an owner notification together, then stamps the invite as used so the link is burned. A second submission on the same token is rejected with "This review has already been submitted". Invalid tokens simply return "Review link not found".

The owner view joins each review to its property and booking reference and computes per-property averages on the fly (rounded to one decimal), over the most recent 200 reviews.

## What to try

1. Check the summary cards: Ruwan's 5★ and Ayesha's 4★ should be reflected in the property averages, each review showing its booking reference.
2. Check out a checked-in demo guest from the Bookings section, then look at the **server console log** for the check-out email — copy the review link out of it (emails are not really sent in this build).
3. Open that link in a private/incognito window: confirm it greets the guest by name with the right property and dates, then submit a rating and comment.
4. Reload this Reviews page — your new review should appear at the top, and the property's average and count should update.
5. Open the same review link again and try to submit twice — it must refuse, telling you the review was already submitted.
6. Check your in-app inbox/notifications for the "New review" alert that arrived with the submission.
7. Tamper with a few characters of the token in the URL — you should get a clean "Review link not found", never someone else's review form.

## Known limitations in this test build

- Emails are console-logged on the server — guests never actually receive the review invitation, so you will need the link from the log to test the guest flow.
- No moderation tools yet: reviews cannot be replied to, hidden, or deleted from the UI.
- The channel manager is simulated and there is no real payment gateway (payments are recorded manually).
- Demo dataset resets are announced in advance; reviews you submit will disappear on reset.
- This is a shared demo tenant — reviews submitted by other testers appear in the same feed.

## Found something? Tell us

Use the feedback form at the bottom of this page — pick a Type (Bug / Change request / Feature idea) and a Severity, then describe **what you tried**, **what you expected**, and **what happened**, with a screenshot if possible. Every submission lands in our triage board and shapes the next build.
