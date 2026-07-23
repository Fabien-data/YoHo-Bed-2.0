# Profile — Feature Guide

> Who you are, your account's standing with YoHoBed, where your payouts go, and your password.

## What this section does

**Profile** is the owner's account page, split into two cards:

- **Your details** — your name, login email, and business name, with a status pill next to the page title showing your tenant's standing: **active** (fully operational), **pending** (signed up, awaiting YoHoBed approval — you can set everything up, but taking bookings unlocks on activation), or suspended.
- **Platform agreement** — the YoHoBed property agreement covering commission terms, payout schedule, and cancellation handling. If it hasn't been accepted yet, an **Accept agreement** button appears; once accepted, the page shows the acceptance date permanently.
- **Change password** — enter your current password and a new one (minimum 8 characters).
- **Payout account** — the bank account your settlement (net payable) is sent to: bank, branch (optional), account holder name, account number, and SWIFT code (optional, auto-uppercased). The demo tenant comes with _Commercial Bank of Ceylon, Kollupitiya_ branch details already saved. Payout statements in the Finance section use these details.

## How it works behind the scenes

Each hotel business (a _tenant_) has exactly **one payout account** — saving the form either creates it or updates it in place, so there's never a stale duplicate lying around. Agreement acceptance is **one-way and idempotent**: the first click stamps the date and time, and any later attempt simply returns the original timestamp — the accepted date can't be pushed forward by accident.

Password changes go through the authentication service, not the profile service: the API re-checks your **current** password against the stored hash before accepting the new one, so a borrowed open session can't silently change credentials. New passwords are validated server-side (minimum 8 characters) as well as in the form.

Like everything in the PMS, profile data is tenant-isolated at the database level — your bank details are only readable inside your own tenant's session.

## What to try

1. **Read your card.** Confirm the name, email, and business shown match the tester account you were given, and note the status pill (the demo tenant should be _active_).
2. **Update the payout account.** Change the branch name (e.g. from _Kollupitiya_ to _Colombo 03_) and save. Reload the page — the change should persist, and the button should read "Update payout account" rather than "Save".
3. **Test validation.** Try saving the payout form with an empty account number, and type a lowercase SWIFT code — it should uppercase as you type.
4. **Check the agreement.** The demo tenant has likely already accepted — confirm the acceptance date is shown instead of the button. If you see the button, click it once and check the date appears.
5. **Cross-check with Finance.** Open the Finance section's payout statement and verify it reflects the bank details saved here.
6. **Password form errors only.** Enter a wrong current password and confirm you get a clear "Current password is incorrect" message — but please **don't actually change the password** on a shared demo account.

## Known limitations in this test build

- **Shared demo tenant** — every tester uses the same account, which is why password changes are off-limits; bank details you enter are visible to other testers, so use dummy numbers only.
- **Announced resets** — demo data, including payout details, may be reset with notice.
- **Emails are console-logged**, not delivered — account-related mail won't reach a real inbox.
- **The channel manager is simulated**, so account status changes never touch live OTA channels.
- The agreement text itself is summarised on-page; the full legal document isn't rendered in this build.

## Found something? Tell us

Use the feedback form at the bottom of this Notion page: choose a **Type** (Bug / Change / Feature idea) and **Severity**, describe **what you tried, what you expected, and what actually happened**, and attach a **screenshot** if you can. Everything goes to one triage board that shapes the next development phase.
