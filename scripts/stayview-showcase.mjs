#!/usr/bin/env node
/**
 * A busy, realistic hotel for looking at Stay View: ~50 rooms over five room types, a month of
 * stays around today in every state the calendar draws — in house, arriving, departing,
 * confirmed, pending, on hold, unassigned, a group, VIPs, notes, a stay moved mid-way, rooms
 * dirty and rooms blocked. Built through the API as the demo owner, in its own property, so the
 * demo tenant's other data is untouched.
 *
 *   DEMO_API_URL=http://localhost:3001 DEMO_TODAY=2026-09-23 node scripts/stayview-showcase.mjs
 *
 * Config: DEMO_API_URL, DEMO_TODAY (default today), SHOWCASE_SCALE (default 1; 4 ≈ 200 rooms for
 * performance checks), SHOWCASE_NAME. Refuses to run twice into the same property name.
 */

const API = process.env.DEMO_API_URL ?? 'http://localhost:3001';
const TODAY = process.env.DEMO_TODAY ?? new Date().toISOString().slice(0, 10);
const SCALE = Math.max(1, Number(process.env.SHOWCASE_SCALE ?? 1));
const NAME = process.env.SHOWCASE_NAME ?? (SCALE > 1 ? 'Lagoon Crest Grand' : 'Lagoon Crest Hotel');

const d = (offset) => {
  const t = new Date(`${TODAY}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + offset);
  return t.toISOString().slice(0, 10);
};

async function api(method, path, { body, token, allow } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok && !(allow ?? []).includes(res.status))
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return { status: res.status, body: json };
}

// A small deterministic random, so every run builds the same hotel.
let seed = 20260923;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];

const FIRST = [
  'Amaya',
  'Ruwan',
  'Nimali',
  'Kasun',
  'Dilani',
  'Tharindu',
  'Ishara',
  'Chamara',
  'Sachini',
  'Emma',
  'Liam',
  'Sofia',
  'Noah',
  'Hannah',
  'Lukas',
  'Chloé',
  'Mateo',
  'Yuki',
  'Hiroshi',
  'Arjun',
  'Priya',
  'Rahul',
  'Aisha',
  'Omar',
  'Fatima',
  'Wei',
  'Mei',
  'Olivia',
  'James',
  'Isabella',
  'Ethan',
  'Ava',
  'Mia',
  'Leon',
  'Freya',
  'Anika',
  'Ravi',
  'Sanjay',
  'Elena',
];
const LAST = [
  'Perera',
  'Fernando',
  'Silva',
  'Jayawardena',
  'Wickramasinghe',
  'Bandara',
  'Gunawardena',
  'Smith',
  'Müller',
  'Rossi',
  'Dubois',
  'Tanaka',
  'Sato',
  'Sharma',
  'Iyer',
  'Khan',
  'Rahman',
  'Chen',
  'Wang',
  'Johnson',
  'Brown',
  'García',
  'Novak',
  'Andersen',
  'Kowalski',
  'Nair',
];
const guestName = () => `${pick(FIRST)} ${pick(LAST)}`;

const login = await api('POST', '/auth/login', {
  body: { email: 'owner@demo.yohobed.test', password: 'password123' },
});
const token = login.body.accessToken;
const call = (method, path, body, allow) => api(method, path, { body, token, allow });
console.log(`✓ owner signed in · today ${TODAY} · scale ${SCALE}`);

const existing = (await call('GET', '/properties')).body.find((p) => p.name === NAME);
if (existing) {
  console.log(`! "${NAME}" already exists (${existing.id}) — nothing to do.`);
  process.exit(0);
}
const property = (await call('POST', '/properties', { name: NAME })).body;
console.log(`✓ property ${NAME}`);

const bb = (await call('GET', '/rate-codes')).body.find((c) => c.code === 'BB');
const sources = (await call('GET', '/business-sources')).body.filter((s) => s.active !== false);

const TYPES = [
  { name: 'Standard Queen', count: 16, base: 21000, floors: [1, 2], names: [] },
  { name: 'Deluxe King', count: 14, base: 28500, floors: [2, 3], names: [] },
  { name: 'Deluxe Twin', count: 10, base: 27000, floors: [3, 4], names: [] },
  {
    name: 'Junior Suite',
    count: 6,
    base: 42000,
    floors: [4],
    names: ['Lotus', 'Orchid', 'Jasmine', 'Frangipani', 'Cinnamon', 'Ebony'],
  },
  { name: 'Family Room', count: 4, base: 36000, floors: [5], names: [] },
];

const types = [];
let order = 0;
const perFloor = {};
for (const t of TYPES) {
  const count = t.count * SCALE;
  const room = (
    await call('POST', `/properties/${property.id}/rooms`, { name: t.name, quantity: count })
  ).body;
  const plan = (await call('POST', `/rooms/${room.id}/rate-plans`, { rateCodeId: bb.id })).body;
  const occ = (
    await call('POST', `/rate-plans/${plan.id}/occupancies`, {
      label: 'Double',
      accommodates: t.name === 'Family Room' ? 4 : 2,
    })
  ).body;
  await call('POST', `/rooms/${room.id}/availability`, {
    from: d(-30),
    to: d(90),
    roomsToSell: count,
    status: 'Open',
  });
  await call('POST', `/occupancies/${occ.id}/price`, { from: d(-30), to: d(90), base: t.base });
  const units = Array.from({ length: count }, (_, i) => {
    const floor =
      t.floors[Math.min(t.floors.length - 1, Math.floor((i / count) * t.floors.length))];
    perFloor[floor] = (perFloor[floor] ?? 0) + 1;
    return {
      roomId: room.id,
      code: `${floor}${String(perFloor[floor]).padStart(SCALE > 1 ? 3 : 2, '0')}`,
      displayName: t.names[i] ?? null,
      floor: String(floor),
      displayOrder: order + i,
    };
  });
  order += count;
  const created = (await call('POST', `/properties/${property.id}/room-units/bulk`, { units }))
    .body;
  types.push({ ...t, count, room, occ, units: created });
  console.log(`✓ ${t.name}: ${count} rooms`);
}

let made = 0;
const stays = [];
async function walkIn(type, unit, checkin, checkout, name, opts = {}) {
  const res = await call('POST', '/bookings', {
    roomId: type.room.id,
    occupancyId: type.occ.id,
    checkin,
    checkout,
    rooms: 1,
    customerName: name,
    customerEmail: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
  });
  const b = res.body;
  if (unit) {
    const legs = (await call('GET', `/bookings/${b.id}/rooms`)).body;
    await call('POST', `/bookings/${b.id}/assign`, {
      assignments: [{ legId: legs[0].id, roomUnitId: unit.id }],
    });
  }
  if (opts.approve !== false) await call('POST', `/bookings/${b.id}/approve`);
  made++;
  stays.push({ id: b.id, type, unit, checkin, checkout, name });
  return b;
}

// Fill each room's timeline: a few days of history, today, and a month ahead.
for (const type of types) {
  for (const unit of type.units) {
    let day = -6 - Math.floor(rand() * 4);
    while (day < 34) {
      const gap = rand() < 0.35 ? 0 : 1 + Math.floor(rand() * 3);
      day += gap;
      const nights = 1 + Math.floor(rand() * (type.name === 'Junior Suite' ? 6 : 4));
      const checkin = d(day);
      const checkout = d(day + nights);
      day += nights;
      if (rand() < 0.22) continue; // leave some holes to sell
      const inPast = day <= 0;
      const inHouse = !inPast && checkin <= TODAY;
      const name = guestName();
      if (inPast) {
        // Recent history only; older nights are noise. A past stay was paid and left, and its
        // room was cleaned for whoever came next.
        if (day < -4) continue;
        const b = await walkIn(type, unit, checkin, checkout, name);
        const inn = await call('POST', `/bookings/${b.id}/check-in`, undefined, [409]);
        if (inn.status === 200) {
          const amount = (await call('GET', `/bookings/${b.id}`)).body.amount;
          await call('POST', `/bookings/${b.id}/payments`, {
            amount: Number(amount),
            direction: 'received',
            method: 'card',
          });
          await call('POST', `/bookings/${b.id}/check-out`, undefined, [409]);
        }
        await call(
          'POST',
          `/properties/${property.id}/housekeeping`,
          { roomUnitId: unit.id, date: TODAY, status: 'clean' },
          [400, 409],
        );
        continue;
      }
      if (inHouse) {
        const b = await walkIn(type, unit, checkin, checkout, name);
        // Half of today's arrivals are still to come, so there is a desk to work.
        if (checkin === TODAY && rand() < 0.5) continue;
        const r = await call('POST', `/bookings/${b.id}/check-in`, undefined, [409]);
        if (r.status === 200 && rand() < 0.5) {
          const amount = (await call('GET', `/bookings/${b.id}`)).body.amount;
          await call('POST', `/bookings/${b.id}/payments`, {
            amount: Math.round(Number(amount) * (rand() < 0.5 ? 1 : 0.4)),
            direction: 'received',
            method: 'card',
          });
        }
        continue;
      }
      // The future: mostly confirmed, some pending, some held.
      const roll = rand();
      if (roll < 0.1) {
        const lines = [
          {
            roomId: type.room.id,
            occupancyId: type.occ.id,
            roomUnitId: unit.id,
            adults: 2,
            children: 0,
          },
        ];
        const holdUntil = new Date(
          `${d(Math.max(1, Math.floor(rand() * 3)))}T12:00:00+05:30`,
        ).toISOString();
        const r = await call(
          'POST',
          '/reservations',
          {
            propertyId: property.id,
            checkin,
            checkout,
            kind: 'hold_confirm',
            holdUntil,
            guest: { name },
            lines,
          },
          [400, 409, 422],
        );
        if (r.status === 201) made++;
      } else if (roll < 0.22) {
        await walkIn(type, unit, checkin, checkout, name, { approve: false });
      } else {
        const source = sources.length && rand() < 0.45 ? pick(sources) : null;
        const lines = [
          {
            roomId: type.room.id,
            occupancyId: type.occ.id,
            roomUnitId: unit.id,
            adults: rand() < 0.2 ? 1 : 2,
            children: rand() < 0.15 ? 1 : 0,
          },
        ];
        const r = await call(
          'POST',
          '/reservations',
          {
            propertyId: property.id,
            checkin,
            checkout,
            kind: 'confirm',
            guest: { name },
            lines,
            ...(source ? { businessSourceId: source.id } : {}),
          },
          [400, 409, 422],
        );
        if (r.status === 201) {
          made++;
          stays.push({ id: r.body.bookings[0].id, type, unit, checkin, checkout, name });
        }
      }
    }
  }
}
console.log(`✓ ${made} stays on the rooms`);

// Stays still waiting for a room (the Unassigned lane and panel).
const deluxe = types[1];
for (const [from, n] of [
  [1, 2],
  [3, 3],
  [6, 2],
  [9, 4],
]) {
  await walkIn(deluxe, null, d(from), d(from + n), guestName());
}
console.log('✓ 4 unassigned stays');

// A group of three rooms arriving together.
const twin = types[2];
const groupUnits = twin.units
  .filter((u) => !stays.some((s) => s.unit?.id === u.id && s.checkin < d(16) && d(12) < s.checkout))
  .slice(0, 3);
if (groupUnits.length === 3) {
  const r = await call(
    'POST',
    '/reservations',
    {
      propertyId: property.id,
      checkin: d(12),
      checkout: d(16),
      kind: 'confirm',
      guest: { name: 'Nordic Travel Group' },
      lines: groupUnits.map((u) => ({
        roomId: twin.room.id,
        occupancyId: twin.occ.id,
        roomUnitId: u.id,
        adults: 2,
        children: 0,
      })),
    },
    [400, 409, 422],
  );
  if (r.status === 201) console.log('✓ a three-room group');
}

// VIPs and notes on a few stays.
const upcoming = stays.filter((s) => s.checkin >= TODAY).slice(0, 40);
for (const s of upcoming.filter((_, i) => i % 9 === 0)) {
  const b = (await call('GET', `/bookings/${s.id}`)).body;
  if (b.customerId)
    await call('PATCH', `/customers/${b.customerId}`, { vip: true }, [400, 403, 404]);
}
for (const [i, s] of upcoming.filter((_, i) => i % 5 === 1).entries()) {
  await call('POST', `/bookings/${s.id}/remarks`, {
    type: i % 2 ? 'preference' : 'front_desk',
    text:
      i % 2
        ? 'Prefers a high floor, away from the lift.'
        : 'Late arrival around 23:00 — keep the room.',
  });
}
console.log('✓ VIPs and notes');

// Rooms off sale.
const free = (type, from, to) =>
  type.units.find(
    (u) => !stays.some((s) => s.unit?.id === u.id && s.checkin < to && from < s.checkout),
  );
const oos = free(types[0], d(2), d(5));
if (oos)
  await call(
    'POST',
    `/properties/${property.id}/blocks`,
    {
      roomUnitId: oos.id,
      blockFrom: d(2),
      blockTo: d(5),
      reason: 'Bathroom retiling',
      kind: 'out_of_service',
    },
    [409],
  );
const owner = free(types[3], d(7), d(11));
if (owner)
  await call(
    'POST',
    `/properties/${property.id}/blocks`,
    {
      roomUnitId: owner.id,
      blockFrom: d(7),
      blockTo: d(11),
      reason: 'Owner visit',
      kind: 'blocked',
    },
    [409],
  );
console.log('✓ blocks');

// Departures leave rooms dirty; one in-house guest has already moved rooms once.
await call(
  'POST',
  `/properties/${property.id}/housekeeping/mark-departures-dirty?date=${TODAY}`,
  undefined,
  [400, 404],
);
const mover = stays.find((s) => s.unit && s.checkin < TODAY && s.checkout > d(1));
if (mover) {
  const target = free(mover.type, TODAY, mover.checkout);
  const legs = (await call('GET', `/bookings/${mover.id}/rooms`)).body.filter((l) => !l.releasedAt);
  const leg = legs.find((l) => l.checkout > TODAY);
  if (target && leg) {
    const r = await call(
      'POST',
      `/bookings/${mover.id}/room-move`,
      { legId: leg.id, toRoomUnitId: target.id },
      [409],
    );
    if (r.status === 200) console.log(`✓ ${mover.name} moved mid-stay (a split stay)`);
  }
}

console.log(
  `\nShowcase ready: switch the property to "${NAME}" in the header, then open Stay View.`,
);
