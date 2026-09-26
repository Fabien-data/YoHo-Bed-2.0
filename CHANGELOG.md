# Changelog

Notable changes to YoHoBed 2.0, newest first. Each entry is a release that went live on the
testing server. Pull request numbers link to the full description of each change.

## 2026-09-24 — Stay View command centre

- Stay View becomes the front-desk command centre: safe room moves, pointer drag, one side panel
  for every booking action, and live updates to every open calendar over Server-Sent Events
  ([#17](https://github.com/Fabien-data/YoHo-Bed-2.0/pull/17),
  [#18](https://github.com/Fabien-data/YoHo-Bed-2.0/pull/18)).
- A 50-room showcase hotel in the demo data, with groups, split stays and blocks.
- Fixed: the Dashboard and night audit now use the hotel's local date, not the browser's.

## 2026-09-23 — Malaysia & India money, smart setup, global search

- Forward tax engine for Malaysia (SST, Tourism Tax) and India (GST slabs, Form C).
- Smart property setup ([#14](https://github.com/Fabien-data/YoHo-Bed-2.0/pull/14)).
- Global search for reservations and guests, and front-desk shortcuts.
- Room View and Floor View transitions.

## 2026-09-22 — The safe front desk

- Security fix: only the owner can see or change payout details
  ([#10](https://github.com/Fabien-data/YoHo-Bed-2.0/pull/10)).
- UX standard, click budgets and first-party UX measurement
  ([#11](https://github.com/Fabien-data/YoHo-Bed-2.0/pull/11)).
- Guided check-in and check-out, one desk action bar, in-house date changes
  ([#12](https://github.com/Fabien-data/YoHo-Bed-2.0/pull/12),
  [#13](https://github.com/Fabien-data/YoHo-Bed-2.0/pull/13)).

## 2026-09-21 — Room View and Floor View

- Room and floor operations workspace, with the PDF workflow
  ([#8](https://github.com/Fabien-data/YoHo-Bed-2.0/pull/8),
  [#9](https://github.com/Fabien-data/YoHo-Bed-2.0/pull/9)).

## 2026-09-18 to 2026-09-20 — Reservations (Phase 02, Sprints 1–6)

- Reservation engine and Quick Reservation
  ([#4](https://github.com/Fabien-data/YoHo-Bed-2.0/pull/4)).
- Full Add Reservation page and the Reservations list
  ([#5](https://github.com/Fabien-data/YoHo-Bed-2.0/pull/5)).
- Payments at reservation, Bill To routing and walk-in check-in
  ([#6](https://github.com/Fabien-data/YoHo-Bed-2.0/pull/6)).
- Sri Lankan tax invoices, pro-formas, credit notes with gap-free numbering, booking vouchers and
  the public guest booking page ([#7](https://github.com/Fabien-data/YoHo-Bed-2.0/pull/7)).

## 2026-08-29 — Yanolja-parity PMS

- Entitlements, room units, Stay View, front desk, cashiering and night audit
  ([#1](https://github.com/Fabien-data/YoHo-Bed-2.0/pull/1),
  [#2](https://github.com/Fabien-data/YoHo-Bed-2.0/pull/2),
  [#3](https://github.com/Fabien-data/YoHo-Bed-2.0/pull/3)).
- The Ink Navy & Brass design system.
- Pre-deployment security audit: six critical fixes, including overbooking on reopen and
  cross-tenant media access.

## 2026-07-28 — Multi-currency

- USD or LKR as each property's base currency; INR, GBP and EUR for display; exchange rates
  fetched automatically.
- Reproducible server provisioning, deploy and nightly backup scripts in `infra/`.

## 2026-07-12 to 2026-07-27 — Legacy-parity MVP

- The owner PMS, staff console, channel-manager inbox, front desk, onboarding, email, photos,
  reviews and CRM, rebuilt from the legacy platform.
- The four legacy bugs fixed and guarded by tests: the overbooking race, walk-in pricing on the
  wrong key, silent channel-sync failures and the booking-reference race.
- First deployment to the testing server.
