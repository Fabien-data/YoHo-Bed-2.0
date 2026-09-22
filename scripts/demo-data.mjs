/**
 * YoHoBed 2.0 — client-demo data builder.
 * Drives the REAL API as the seeded demo owner, so every row is produced by
 * the actual business logic: parity pricing, tax decomposition, inventory reservation,
 * notifications, guest emails, CM outbox events, review invites.
 *
 * Idempotency: run AFTER a fresh `db:seed` (seed resets the demo tenant's properties).
 * Tenant-level records (coupons, referral partners) survive a re-seed, so their creates
 * tolerate "already exists" responses.
 *
 * Config: DEMO_API_URL (default http://localhost:3001), DEMO_TODAY (default: current date).
 * All demo dates are derived from TODAY so the dataset always tells "today's story".
 */
const API = process.env.DEMO_API_URL ?? 'http://localhost:3001';
const TODAY = process.env.DEMO_TODAY ?? new Date().toISOString().slice(0, 10);

/** ISO date `offset` days from TODAY (0 = today, negative = past). */
function d(offset) {
  const t = new Date(`${TODAY}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + offset);
  return t.toISOString().slice(0, 10);
}

async function api(method, path, { body, token, headers, allow } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
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
  if (!res.ok && !(allow ?? []).includes(res.status)) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return { status: res.status, body: json };
}

const log = (m) => console.log(`  ${m}`);

// ---------- login + discovery ----------
const login = await api('POST', '/auth/login', {
  body: { email: 'owner@demo.yohobed.test', password: 'password123' },
});
const token = login.body.accessToken;
console.log('✓ logged in as owner');

const props = (await api('GET', '/properties', { token })).body;
const lakeside = props.find((p) => p.name === 'Cinnamon Lakeside');
const villa = props.find((p) => p.name === 'Ceylon Tax Villa');
if (!lakeside || !villa) throw new Error('seed properties missing — run db:seed first');

async function roomAndOcc(propertyId, roomName) {
  const rooms = (await api('GET', `/properties/${propertyId}/rooms`, { token })).body;
  const room = rooms.find((r) => r.name === roomName);
  const plans = (await api('GET', `/rooms/${room.id}/rate-plans`, { token })).body;
  const occs = (await api('GET', `/rate-plans/${plans[0].id}/occupancies`, { token })).body;
  return { room, occ: occs[0] };
}
const dlx = await roomAndOcc(lakeside.id, 'Deluxe Room');
const ocn = await roomAndOcc(villa.id, 'Ocean Suite');
console.log(
  `✓ discovered rooms: Deluxe ${dlx.room.id.slice(0, 8)}…, Ocean ${ocn.room.id.slice(0, 8)}…`,
);

// ---------- ARI: open + price a window around today (8 days back → 39 days ahead) ----------
const FROM = d(-8),
  TO = d(39);
function datesBetween(from, to) {
  const out = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d.toISOString().slice(0, 10) <= to;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    out.push(d.toISOString().slice(0, 10));
  return out;
}
const weekends = datesBetween(FROM, TO).filter((d) =>
  [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()),
);

for (const [r, qty] of [
  [dlx, 5],
  [ocn, 3],
]) {
  await api('POST', `/rooms/${r.room.id}/availability`, {
    token,
    body: { from: FROM, to: TO, roomsToSell: qty, status: 'Open' },
  });
  await api('POST', `/occupancies/${r.occ.id}/price`, {
    token,
    body: { from: FROM, to: TO, base: 18000 },
  });
  for (const d of weekends)
    await api('POST', `/occupancies/${r.occ.id}/price`, {
      token,
      body: { from: d, to: d, base: 25000 },
    });
}
// Ocean Suite: 15% last-minute drop ~1.5 weeks out (the seeded showcase, re-applied after repricing)
await api('POST', `/occupancies/${ocn.occ.id}/last-minute-drop`, {
  token,
  body: { from: d(9), to: d(11), dropPct: 15 },
});
// Min-stay 2 nights on Deluxe ~3 weeks out (restriction showcase)
await api('POST', `/rooms/${dlx.room.id}/restrictions`, {
  token,
  body: { from: d(22), to: d(24), minStay: 2, maxStay: 0 },
});
console.log(
  `✓ ARI: both rooms open + priced ${FROM} → ${TO} (Rs 18,000 wk / 25,000 wknd), drop + min-stay set`,
);

// ---------- commercial setup (before bookings that use the codes) ----------
await api('POST', '/coupons', {
  token,
  allow: [400, 409],
  body: { code: 'SUMMER10', type: 'percentage', value: 10, from: d(-22), to: d(39), maxUses: 0 },
});
await api('POST', '/coupons', {
  token,
  allow: [400, 409],
  body: {
    code: 'FAMILY5000',
    type: 'fixed',
    value: 5000,
    from: d(-8),
    to: d(39),
    maxUses: 20,
    propertyId: lakeside.id,
  },
});
await api('POST', '/referral-partners', {
  token,
  allow: [400, 409],
  body: { name: 'Island Travels (Pvt) Ltd', code: 'ISLAND', commissionPct: 5 },
});
const promo = await api('POST', `/properties/${lakeside.id}/promotions`, {
  token,
  body: { name: 'Getaway Deal', discountPct: 15, from: d(23), to: d(28), minNights: 1 },
});
await api('POST', `/promotions/${promo.body.id}/apply`, { token });
console.log(
  '✓ commercial: coupons SUMMER10 + FAMILY5000, partner ISLAND (5%), promo "Getaway Deal −15%" applied to calendar',
);

// ---------- payout bank account ----------
await api('PUT', '/profile/payout-account', {
  token,
  body: {
    bankName: 'Commercial Bank of Ceylon',
    branchName: 'Kollupitiya',
    accountName: 'Cinnamon Lakeside (Pvt) Ltd',
    accountNumber: '8001234567',
    swiftCode: 'CCEYLKLX',
  },
});
console.log('✓ profile: settlement bank account saved');

// ---------- bookings ----------
async function book(r, guest, checkin, checkout, extra = {}) {
  const res = await api('POST', '/bookings', {
    token,
    body: {
      roomId: r.room.id,
      occupancyId: r.occ.id,
      checkin,
      checkout,
      rooms: 1,
      ...guest,
      ...extra,
    },
  });
  return res.body;
}
const act = (id, action) => api('POST', `/bookings/${id}/${action}`, { token });

let seenTokens = new Set();
async function latestReviewToken() {
  const msgs = (await api('GET', '/messages', { token })).body;
  for (const m of msgs) {
    const match = `${m.body ?? ''}`.match(/\/review\/([0-9a-f-]{36})/i);
    if (match && !seenTokens.has(match[1])) {
      seenTokens.add(match[1]);
      return match[1];
    }
  }
  throw new Error('no unseen review token found in messages');
}

// 1) Completed stay + 5★ review — Ruwan Perera, Deluxe (5→2 days ago)
const b1 = await book(
  dlx,
  {
    customerName: 'Ruwan Perera',
    customerEmail: 'ruwan.perera@gmail.com',
    customerPhone: '+94 77 123 4567',
  },
  d(-5),
  d(-2),
);
await act(b1.id, 'approve');
await act(b1.id, 'check-in');
// Invoiced and paid in full before leaving: check-out refuses an unpaid balance (UX-1a).
const inv1 = await api('POST', `/bookings/${b1.id}/invoice`, { token });
await api('POST', `/bookings/${b1.id}/payments`, {
  token,
  body: {
    direction: 'received',
    amount: Number(b1.amount),
    method: 'card',
    reference: 'VISA-4212',
  },
});
await act(b1.id, 'check-out');
await api('POST', '/reviews', {
  body: {
    token: await latestReviewToken(),
    rating: 5,
    comment:
      'Superb lakeside stay — the Deluxe Room was spotless and the front desk went out of their way for us. Will be back!',
  },
});
log(`B1 ${b1.reference} Ruwan Perera · CheckedOut + 5★ review`);

// 2) Completed stay + 4★ review — Ayesha Khan, Ocean (7→5 days ago)
const b2 = await book(
  ocn,
  { customerName: 'Ayesha Khan', customerEmail: 'ayesha.khan@outlook.com' },
  d(-7),
  d(-5),
);
await act(b2.id, 'approve');
await act(b2.id, 'check-in');
await api('POST', `/bookings/${b2.id}/payments`, {
  token,
  body: { direction: 'received', amount: Number(b2.amount), method: 'cash' },
});
await act(b2.id, 'check-out');
await api('POST', '/reviews', {
  body: {
    token: await latestReviewToken(),
    rating: 4,
    comment:
      'Beautiful ocean views and a generous breakfast. Wi-Fi was a little slow but everything else was perfect.',
  },
});
log(`B2 ${b2.reference} Ayesha Khan · CheckedOut + 4★ review`);

// 3) In-house now — Emma Whitfield, Deluxe (2 days ago → 2 days ahead)
const b3 = await book(
  dlx,
  {
    customerName: 'Emma Whitfield',
    customerEmail: 'emma.whitfield@gmail.com',
    customerPhone: '+44 7700 900123',
  },
  d(-2),
  d(2),
);
await act(b3.id, 'approve');
await act(b3.id, 'check-in');
log(`B3 ${b3.reference} Emma Whitfield · CheckedIn (in-house)`);

// 4) Departing TODAY (live check-out demo) — Sofia Marchetti, Deluxe
const b4 = await book(
  dlx,
  { customerName: 'Sofia Marchetti', customerEmail: 'sofia.marchetti@gmail.com' },
  d(-3),
  TODAY,
);
await act(b4.id, 'approve');
await act(b4.id, 'check-in');
log(`B4 ${b4.reference} Sofia Marchetti · CheckedIn, departs today → live check-out`);

// 5) Arriving TODAY (live check-in demo) — Kasun Jayawardena, Deluxe
const b5 = await book(
  dlx,
  {
    customerName: 'Kasun Jayawardena',
    customerEmail: 'kasun.j@yahoo.com',
    customerPhone: '+94 71 555 8899',
  },
  TODAY,
  d(3),
);
await act(b5.id, 'approve');
log(`B5 ${b5.reference} Kasun Jayawardena · Approved, arrives today → live check-in`);

// 6) No-show — Harsha Wickramasinghe, Deluxe (4→3 days ago)
const b6 = await book(dlx, { customerName: 'Harsha Wickramasinghe' }, d(-4), d(-3));
await act(b6.id, 'approve');
await act(b6.id, 'no-show');
log(`B6 ${b6.reference} Harsha Wickramasinghe · NoShow`);

// 7) Invoice + partial payment — Tharindu Fernando, Ocean (tomorrow → +3)
const b7 = await book(
  ocn,
  { customerName: 'Tharindu Fernando', customerEmail: 'tharindu.f@gmail.com' },
  d(1),
  d(3),
);
await act(b7.id, 'approve');
const inv7 = await api('POST', `/bookings/${b7.id}/invoice`, { token });
await api('POST', `/bookings/${b7.id}/payments`, {
  token,
  body: {
    direction: 'received',
    amount: Math.round(Number(b7.amount) / 2),
    method: 'bank',
    reference: 'ADV-2607-114',
  },
});
log(`B7 ${b7.reference} Tharindu Fernando · Approved, ${inv7.body.number} 50% paid (advance)`);

// 8) Referral booking — Chen Wei via ISLAND, Ocean (+2 → +5)
const b8 = await book(
  ocn,
  { customerName: 'Chen Wei', customerEmail: 'chen.wei@163.com' },
  d(2),
  d(5),
  { referralCode: 'ISLAND' },
);
await act(b8.id, 'approve');
log(`B8 ${b8.reference} Chen Wei · Approved via referral partner ISLAND`);

// 9) Pending (owner live-approve demo) — Dinesh Fernando, Deluxe (+11 → +14)
const b9 = await book(
  dlx,
  {
    customerName: 'Dinesh Fernando',
    customerEmail: 'dinesh.fernando@gmail.com',
    customerPhone: '+94 76 222 3344',
  },
  d(11),
  d(14),
);
log(`B9 ${b9.reference} Dinesh Fernando · Pending → live approve demo`);

// 10) Pending (staff console demo) — Priya Sharma, Deluxe (+5 → +7)
const b10 = await book(
  dlx,
  { customerName: 'Priya Sharma', customerEmail: 'priya.sharma@gmail.com' },
  d(5),
  d(7),
);
log(`B10 ${b10.reference} Priya Sharma · Pending → staff console demo`);

// 11) Coupon booking — Aisha Rahman + SUMMER10, Deluxe (+15 → +18)
const b11 = await book(
  dlx,
  { customerName: 'Aisha Rahman', customerEmail: 'aisha.rahman@gmail.com' },
  d(15),
  d(18),
  { couponCode: 'SUMMER10' },
);
await act(b11.id, 'approve');
log(`B11 ${b11.reference} Aisha Rahman · Approved with SUMMER10 (−10%): Rs ${b11.amount}`);

// 12) Cancelled — Liam O'Connor, Deluxe (+13 → +16)
const b12 = await book(
  dlx,
  { customerName: "Liam O'Connor", customerEmail: 'liam.oconnor@gmail.com' },
  d(13),
  d(16),
);
await act(b12.id, 'cancel');
log(`B12 ${b12.reference} Liam O'Connor · Cancelled (inventory released)`);

// 13) Tax + last-minute-drop showcase — Nadeesha Silva, Ocean (+9 → +12, inside the drop window)
const b13 = await book(
  ocn,
  { customerName: 'Nadeesha Silva', customerEmail: 'nadeesha.silva@gmail.com' },
  d(9),
  d(12),
);
await act(b13.id, 'approve');
log(`B13 ${b13.reference} Nadeesha Silva · Approved on dropped+taxed rates: Rs ${b13.amount}`);

// ---------- finance: B1's invoice was paid at check-out; recent-period payout snapshot ----------
await api('POST', '/finance/payouts', {
  token,
  body: { propertyId: lakeside.id, from: d(-22), to: d(8) },
});
console.log(
  `✓ finance: ${inv1.body.number} PAID in full, payout snapshot (${d(-22)} → ${d(8)}) saved for Cinnamon Lakeside`,
);

// ---------- OTA inbox: two clean imports + one failed (retry demo) ----------
await api('POST', '/ota/simulate', {
  token,
  body: {
    roomId: dlx.room.id,
    channel: 'booking.com',
    guestName: 'Hannah Lee',
    checkin: d(20),
    checkout: d(22),
  },
});
await api('POST', '/ota/simulate', {
  token,
  body: {
    roomId: ocn.room.id,
    channel: 'agoda',
    guestName: 'Marco Rossi',
    checkin: d(28),
    checkout: d(30),
  },
});
// Deliberately outside the priced window (TO = d(39)) so the import fails and the Retry demo works.
await api('POST', '/ota/simulate', {
  token,
  allow: [400, 422, 500],
  body: {
    roomId: dlx.room.id,
    channel: 'expedia',
    guestName: 'Yuki Tanaka',
    checkin: d(41),
    checkout: d(43),
  },
});
console.log(
  '✓ OTA inbox: booking.com + agoda imported (auto-approved), expedia far-out stay FAILED (no rates) → live Retry demo',
);

// ---------- scarcity marker: +18 days back to 1 room (overbooking-guard story) ----------
await api('POST', `/rooms/${dlx.room.id}/availability`, {
  token,
  body: { from: d(18), to: d(18), roomsToSell: 1, status: 'Open' },
});

// ---------- a pending signup for the staff-console approval demo ----------
await api('POST', '/auth/register', {
  allow: [409],
  body: {
    ownerName: 'Shanika De Silva',
    businessName: 'Villa Serendib',
    email: 'shanika@villaserendib.lk',
    password: 'password123',
  },
});
console.log('✓ pending signup "Villa Serendib" awaiting staff approval');

// ---------- verify the dashboard tells today's story ----------
const dash = (await api('GET', `/dashboard?date=${TODAY}`, { token })).body;
console.log('\n=== DASHBOARD CHECK (today) ===');
console.log(
  `  arrivals: ${dash.arrivals?.length}  departures: ${dash.departures?.length}  inHouse: ${dash.inHouse ?? dash.inHouseCount}  pending: ${dash.pendingCount ?? dash.pending?.length ?? dash.pendingApprovals}`,
);
const revenue = (await api('GET', `/finance/revenue?from=${d(-22)}&to=${d(8)}`, { token })).body;
console.log(`  approvedGross (${d(-22)} → ${d(8)}): Rs ${revenue.approvedGross}`);
const reviews = (await api('GET', '/reviews', { token })).body;
console.log(`  reviews: ${reviews.reviews?.length ?? reviews.length}`);
console.log('\nALL DEMO DATA READY ✓');
