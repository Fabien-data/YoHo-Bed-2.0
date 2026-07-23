# Setup — Feature Guide

> Build the structure everything else prices against: properties → rooms → rate plans (meal plans) → occupancies, plus photos.

## What this section does

**Setup** is the onboarding workbench, laid out as three numbered steps:

1. **Properties** — the hotels or villas in your business. The demo tenant has two: _Cinnamon Lakeside_ and _Ceylon Tax Villa_. You can add a new property by name, and manage its **photo gallery** here.
2. **Rooms** — room types within the selected property (e.g. _Deluxe Room_ at Cinnamon Lakeside, _Ocean Suite_ at Ceylon Tax Villa), each with a **quantity** — how many physical rooms of that type exist. Rooms have their own photo galleries too.
3. **Rate plans & occupancies** — for the selected room, attach **meal plans** from the standard list (RO — room only, BB — bed & breakfast, HB, FB, AI), then add **occupancies** under each plan: guest configurations like "Double · ×2", which are the actual things the Calendar puts prices on.

Photos accept JPEG, PNG or WebP up to 5 MB, keep their display order, and can be deleted.

## How it works behind the scenes

This hierarchy — property → room → rate plan → occupancy — is the pricing skeleton for the whole PMS. When you set a base price on the Calendar, it's stored **per occupancy per date**, and the guest-facing selling price is derived automatically by the pricing engine: base price → YoHoBed commission (percentage or slab, per property) → OTA commission gross-up → per-day tax gross-up. You never type a selling price by hand, which is how rate parity stays intact.

Two related pieces live in the API around this structure:

- **Seasons** — named date ranges per property (e.g. "Peak — Dec 20 to Jan 5") that act as an authoring shortcut: applying a season paints a base price across its whole range for chosen occupancies in one action, through exactly the same pricing engine.
- **OTA room mappings** — each room can be mapped to a channel-manager room code. Incoming OTA reservations arrive carrying that code, which is how the Inbox knows which property and room they belong to. The demo rooms are already mapped, which is why simulated OTA reservations land correctly.

Every structural change is tenant-isolated at the database level (row-level security), so one hotel business can never see another's setup — worth remembering when a lookup "isn't found."

## What to try

1. **Walk the chain.** Select _Cinnamon Lakeside_ → _Deluxe Room_ and confirm its rate plan and occupancies appear in step 3. Switch to _Ceylon Tax Villa_ and check the panels update to the _Ocean Suite_.
2. **Add a new room.** Under Cinnamon Lakeside, add "Garden Villa" with quantity 3. Then give it a meal plan (BB) and an occupancy ("Double", accommodates 2). Visit the Calendar afterwards — the new room should appear, unpriced and closed until you set it up.
3. **Try a duplicate meal plan.** Add BB to a room that already has BB — you should get a clear "already exists" message, not a second copy.
4. **Upload photos.** Add a photo to a property and another to a room (any JPEG/PNG/WebP under 5 MB), then delete one. Try an oversized or wrong-format file and check the error message is understandable.
5. **Create a property.** Add a new property by name and confirm it appears in the list and can be selected — but notice bookings need rooms, plans, occupancies, prices, and availability before it's sellable.
6. **Edge inputs.** Try a room with quantity 0, or an occupancy that accommodates 1 — do the screens behave sensibly?

## Known limitations in this test build

- **The channel manager is simulated** — mapping-related pushes and OTA traffic use a fake adapter, not live channels; emails are console-logged, not delivered.
- **Seasons and OTA mappings have no dedicated screen yet** in this build — they work through the API and demo data; the Setup page covers structure and photos.
- **Shared demo tenant** — rooms and properties you add are visible to all testers.
- **Announced resets** — demo data may be reset with notice, removing test structures you created.

## Found something? Tell us

Use the feedback form at the bottom of this Notion page: choose a **Type** (Bug / Change / Feature idea) and **Severity**, describe **what you tried, what you expected, and what actually happened**, and attach a **screenshot** if you can. Everything goes to one triage board that shapes the next development phase.
