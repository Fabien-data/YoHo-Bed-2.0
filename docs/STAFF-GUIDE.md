# YoHoBed Staff Console — Guide

For YoHo staff operating the platform: approving new properties, overseeing bookings, and
managing tenant standing. The console lives at `/staff`.

## Access

Staff access is a real role, not an email list: your user has a **cross-tenant membership**
(`YOHO_STAFF` or `YOHO_ADMIN`, tenant = none). Sign in on the normal sign-in page — staff are
routed to the console automatically (owners who try to open `/staff` are routed back to their
PMS, and the API refuses them regardless). Staff accounts are created by an administrator;
there is no self-serve staff signup.

> Every action you take here is recorded in the audit trail with your email.

## The screen

**Left — Properties (tenants).** Every tenant on the platform with status pill
(active / pending / suspended / inactive) and, when relevant, an amber **"N pending"** count of
bookings awaiting approval. Click a tenant to load their bookings on the right.

**Right — the selected tenant's bookings.** Reference, guest, stay, status, amount — with
**Approve / Reject** buttons on Pending rows.

**Bottom — audit trail.** The most recent staff actions: timestamp, action, actor, and detail.

## Approving a new property (onboarding)

Owners register self-serve and arrive as **pending**. They can sign in and configure everything
immediately — the point of approval is a human check before they trade.

1. Find the tenant with the **pending** pill (newest owners appear as they register).
2. Optionally review what they've set up (click the tenant to see their bookings; their property
   details are visible through their own PMS).
3. Click **Approve** → the tenant flips to **active**, the amber banner disappears from their
   PMS, and a **welcome email** is sent to them automatically.

## Booking oversight

You can approve or reject any tenant's **Pending** bookings on their behalf — useful while an
owner is unreachable or during onboarding support. The action is identical to the owner doing it
(rejection returns inventory to their calendar) and is audited with your email as the actor.

## Suspending and reactivating

- **Suspend** an active tenant → they can no longer sign in, and any session they already hold
  is refused on the next request. Their data is untouched.
- **Activate** restores a suspended/inactive tenant (or approves a pending one).
- Suspension is for compliance/abuse/payment issues; it is immediate and reversible.

## The audit trail

Every staff action — approvals, rejections, status changes — is appended to an immutable log
with actor email, action, the affected entity, and detail. The console shows the recent trail;
the full log lives in the database (`audit_log`) for compliance queries.

## What staff cannot do (by design)

- Browse or edit a tenant's data outside the booking-approval surface — tenant isolation (RLS)
  applies to staff requests too; the console works through explicitly scoped, audited endpoints.
- Delete bookings, edit prices, or impersonate owners.
- See other tenants' data leak into a tenant view — cross-tenant reads happen one tenant at a
  time, under that tenant's own context.

## Related reading

- [USER-GUIDE.md](USER-GUIDE.md) — what owners see (useful when supporting them).
- [ARCHITECTURE.md](ARCHITECTURE.md) §2 — how roles and tenant isolation are enforced.
