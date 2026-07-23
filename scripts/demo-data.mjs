/**
 * YoHoBed 2.0 — client-demo data builder.
 * Drives the REAL API (localhost:3001) as the seeded demo owner, so every row is produced by
 * the actual business logic: parity pricing, tax decomposition, inventory reservation,
 * notifications, guest emails, CM outbox events, review invites.
 *
 * Idempotency: run AFTER a fresh `db:seed` (seed resets the demo tenant's properties).
 */
const API = 'http://localhost:3001';
const TODAY = '2026-07-23';

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
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
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
console.log(`✓ discovered rooms: Deluxe ${dlx.room.id.slice(0, 8)}…, Ocean ${ocn.room.id.slice(0, 8)}…`);

// ---------- ARI: open + price 2026-07-15 → 2026-08-31 ----------
const FROM = '2026-07-15', TO = '2026-08-31';
function datesBetween(from, to) {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1))
    out.push(d.toISOString().slice(0, 10));
  return out;
}
const weekends = datesBetween(FROM, TO).filter((d) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));

for (const [r, qty] of [[dlx, 5], [ocn, 3]]) {
  await api('POST', `/rooms/${r.room.id}/availability`, { token, body: { from: FROM, to: TO, roomsToSell: qty, status: 'Open' } });
  await api('POST', `/occupancies/${r.occ.id}/price`, { token, body: { from: FROM, to: TO, base: 18000 } });
  for (const d of weekends)
    await api('POST', `/occupancies/${r.occ.id}/price`, { token, body: { from: d, to: d, base: 25000 } });
}
// Ocean Suite: 15% last-minute drop on Aug 1–3 (the seeded showcase, re-applied after repricing)
await api('POST', `/occupancies/${ocn.occ.id}/last-minute-drop`, { token, body: { from: '2026-08-01', to: '2026-08-03', dropPct: 15 } });
// Min-stay 2 nights on Deluxe over the Aug 15 weekend (restriction showcase)
await api('POST', `/rooms/${dlx.room.id}/restrictions`, { token, body: { from: '2026-08-14', to: '2026-08-16', minStay: 2, maxStay: 0 } });
console.log(`✓ ARI: both rooms open + priced ${FROM} → ${TO} (Rs 18,000 wk / 25,000 wknd), drop + min-stay set`);

// ---------- commercial setup (before bookings that use the codes) ----------
await api('POST', '/coupons', { token, allow: [409], body: { code: 'SUMMER10', type: 'percentage', value: 10, from: '2026-07-01', to: '2026-08-31', maxUses: 0 } });
await api('POST', '/coupons', { token, allow: [409], body: { code: 'FAMILY5000', type: 'fixed', value: 5000, from: '2026-07-15', to: '2026-08-31', maxUses: 20, propertyId: lakeside.id } });
await api('POST', '/referral-partners', { token, allow: [409], body: { name: 'Island Travels (Pvt) Ltd', code: 'ISLAND', commissionPct: 5 } });
const promo = await api('POST', `/properties/${lakeside.id}/promotions`, { token, body: { name: 'August Getaway', discountPct: 15, from: '2026-08-15', to: '2026-08-20', minNights: 1 } });
await api('POST', `/promotions/${promo.body.id}/apply`, { token });
console.log('✓ commercial: coupons SUMMER10 + FAMILY5000, partner ISLAND (5%), promo "August Getaway −15%" applied to calendar');

// ---------- payout bank account ----------
await api('PUT', '/profile/payout-account', { token, body: { bankName: 'Commercial Bank of Ceylon', branchName: 'Kollupitiya', accountName: 'Cinnamon Lakeside (Pvt) Ltd', accountNumber: '8001234567', swiftCode: 'CCEYLKLX' } });
console.log('✓ profile: settlement bank account saved');

// ---------- bookings ----------
async function book(r, guest, checkin, checkout, extra = {}) {
  const res = await api('POST', '/bookings', {
    token,
    body: { roomId: r.room.id, occupancyId: r.occ.id, checkin, checkout, rooms: 1, ...guest, ...extra },
  });
  return res.body;
}
const act = (id, action) => api('POST', `/bookings/${id}/${action}`, { token });

let seenTokens = new Set();
async function latestReviewToken() {
  const msgs = (await api('GET', '/messages', { token })).body;
  for (const m of msgs) {
    const match = `${m.body ?? ''}`.match(/\/review\/([0-9a-f-]{36})/i);
    if (match && !seenTokens.has(match[1])) { seenTokens.add(match[1]); return match[1]; }
  }
  throw new Error('no unseen review token found in messages');
}

// 1) Completed stay + 5★ review — Ruwan Perera, Deluxe Jul 18–21
const b1 = await book(dlx, { customerName: 'Ruwan Perera', customerEmail: 'ruwan.perera@gmail.com', customerPhone: '+94 77 123 4567' }, '2026-07-18', '2026-07-21');
await act(b1.id, 'approve'); await act(b1.id, 'check-in'); await act(b1.id, 'check-out');
await api('POST', '/reviews', { body: { token: await latestReviewToken(), rating: 5, comment: 'Superb lakeside stay — the Deluxe Room was spotless and the front desk went out of their way for us. Will be back!' } });
log(`B1 ${b1.reference} Ruwan Perera · CheckedOut + 5★ review`);

// 2) Completed stay + 4★ review — Ayesha Khan, Ocean Jul 16–18
const b2 = await book(ocn, { customerName: 'Ayesha Khan', customerEmail: 'ayesha.khan@outlook.com' }, '2026-07-16', '2026-07-18');
await act(b2.id, 'approve'); await act(b2.id, 'check-in'); await act(b2.id, 'check-out');
await api('POST', '/reviews', { body: { token: await latestReviewToken(), rating: 4, comment: 'Beautiful ocean views and a generous breakfast. Wi-Fi was a little slow but everything else was perfect.' } });
log(`B2 ${b2.reference} Ayesha Khan · CheckedOut + 4★ review`);

// 3) In-house now — Emma Whitfield, Deluxe Jul 21–25
const b3 = await book(dlx, { customerName: 'Emma Whitfield', customerEmail: 'emma.whitfield@gmail.com', customerPhone: '+44 7700 900123' }, '2026-07-21', '2026-07-25');
await act(b3.id, 'approve'); await act(b3.id, 'check-in');
log(`B3 ${b3.reference} Emma Whitfield · CheckedIn (in-house)`);

// 4) Departing TODAY (live check-out demo) — Sofia Marchetti, Deluxe Jul 20–23
const b4 = await book(dlx, { customerName: 'Sofia Marchetti', customerEmail: 'sofia.marchetti@gmail.com' }, '2026-07-20', TODAY);
await act(b4.id, 'approve'); await act(b4.id, 'check-in');
log(`B4 ${b4.reference} Sofia Marchetti · CheckedIn, departs today → live check-out`);

// 5) Arriving TODAY (live check-in demo) — Kasun Jayawardena, Deluxe Jul 23–26
const b5 = await book(dlx, { customerName: 'Kasun Jayawardena', customerEmail: 'kasun.j@yahoo.com', customerPhone: '+94 71 555 8899' }, TODAY, '2026-07-26');
await act(b5.id, 'approve');
log(`B5 ${b5.reference} Kasun Jayawardena · Approved, arrives today → live check-in`);

// 6) No-show — Harsha Wickramasinghe, Deluxe Jul 19–20
const b6 = await book(dlx, { customerName: 'Harsha Wickramasinghe' }, '2026-07-19', '2026-07-20');
await act(b6.id, 'approve'); await act(b6.id, 'no-show');
log(`B6 ${b6.reference} Harsha Wickramasinghe · NoShow`);

// 7) Invoice + partial payment — Tharindu Fernando, Ocean Jul 24–26
const b7 = await book(ocn, { customerName: 'Tharindu Fernando', customerEmail: 'tharindu.f@gmail.com' }, '2026-07-24', '2026-07-26');
await act(b7.id, 'approve');
const inv7 = await api('POST', `/bookings/${b7.id}/invoice`, { token });
await api('POST', `/bookings/${b7.id}/payments`, { token, body: { direction: 'received', amount: Math.round(Number(b7.amount) / 2), method: 'bank', reference: 'ADV-2607-114' } });
log(`B7 ${b7.reference} Tharindu Fernando · Approved, ${inv7.body.number} 50% paid (advance)`);

// 8) Referral booking — Chen Wei via ISLAND, Ocean Jul 25–28
const b8 = await book(ocn, { customerName: 'Chen Wei', customerEmail: 'chen.wei@163.com' }, '2026-07-25', '2026-07-28', { referralCode: 'ISLAND' });
await act(b8.id, 'approve');
log(`B8 ${b8.reference} Chen Wei · Approved via referral partner ISLAND`);

// 9) Pending (owner live-approve demo) — Dinesh Fernando, Deluxe Aug 3–6
const b9 = await book(dlx, { customerName: 'Dinesh Fernando', customerEmail: 'dinesh.fernando@gmail.com', customerPhone: '+94 76 222 3344' }, '2026-08-03', '2026-08-06');
log(`B9 ${b9.reference} Dinesh Fernando · Pending → live approve demo`);

// 10) Pending (staff console demo) — Priya Sharma, Deluxe Jul 28–30
const b10 = await book(dlx, { customerName: 'Priya Sharma', customerEmail: 'priya.sharma@gmail.com' }, '2026-07-28', '2026-07-30');
log(`B10 ${b10.reference} Priya Sharma · Pending → staff console demo`);

// 11) Coupon booking — Aisha Rahman + SUMMER10, Deluxe Aug 7–10
const b11 = await book(dlx, { customerName: 'Aisha Rahman', customerEmail: 'aisha.rahman@gmail.com' }, '2026-08-07', '2026-08-10', { couponCode: 'SUMMER10' });
await act(b11.id, 'approve');
log(`B11 ${b11.reference} Aisha Rahman · Approved with SUMMER10 (−10%): Rs ${b11.amount}`);

// 12) Cancelled — Liam O'Connor, Deluxe Aug 5–8
const b12 = await book(dlx, { customerName: "Liam O'Connor", customerEmail: 'liam.oconnor@gmail.com' }, '2026-08-05', '2026-08-08');
await act(b12.id, 'cancel');
log(`B12 ${b12.reference} Liam O'Connor · Cancelled (inventory released)`);

// 13) Tax + last-minute-drop showcase — Nadeesha Silva, Ocean Aug 1–4
const b13 = await book(ocn, { customerName: 'Nadeesha Silva', customerEmail: 'nadeesha.silva@gmail.com' }, '2026-08-01', '2026-08-04');
await act(b13.id, 'approve');
log(`B13 ${b13.reference} Nadeesha Silva · Approved on dropped+taxed rates: Rs ${b13.amount}`);

// ---------- finance: paid invoice for B1, July payout snapshot ----------
const inv1 = await api('POST', `/bookings/${b1.id}/invoice`, { token });
await api('POST', `/bookings/${b1.id}/payments`, { token, body: { direction: 'received', amount: Number(b1.amount), method: 'card', reference: 'VISA-4212' } });
await api('POST', '/finance/payouts', { token, body: { propertyId: lakeside.id, from: '2026-07-01', to: '2026-07-31' } });
console.log(`✓ finance: ${inv1.body.number} PAID in full, July payout snapshot saved for Cinnamon Lakeside`);

// ---------- OTA inbox: two clean imports + one failed (retry demo) ----------
await api('POST', '/ota/simulate', { token, body: { roomId: dlx.room.id, channel: 'booking.com', guestName: 'Hannah Lee', checkin: '2026-08-12', checkout: '2026-08-14' } });
await api('POST', '/ota/simulate', { token, body: { roomId: ocn.room.id, channel: 'agoda', guestName: 'Marco Rossi', checkin: '2026-08-20', checkout: '2026-08-22' } });
await api('POST', '/ota/simulate', { token, allow: [400, 422, 500], body: { roomId: dlx.room.id, channel: 'expedia', guestName: 'Yuki Tanaka', checkin: '2026-09-02', checkout: '2026-09-04' } });
console.log('✓ OTA inbox: booking.com + agoda imported (auto-approved), expedia Sep stay FAILED (no rates) → live Retry demo');

// ---------- scarcity marker: Aug 10 back to 1 room (overbooking-guard story) ----------
await api('POST', `/rooms/${dlx.room.id}/availability`, { token, body: { from: '2026-08-10', to: '2026-08-10', roomsToSell: 1, status: 'Open' } });

// ---------- a pending signup for the staff-console approval demo ----------
await api('POST', '/auth/register', { allow: [409], body: { ownerName: 'Shanika De Silva', businessName: 'Villa Serendib', email: 'shanika@villaserendib.lk', password: 'password123' } });
console.log('✓ pending signup "Villa Serendib" awaiting staff approval');

// ---------- verify the dashboard tells today's story ----------
const dash = (await api('GET', `/dashboard?date=${TODAY}`, { token })).body;
console.log('\n=== DASHBOARD CHECK (today) ===');
console.log(`  arrivals: ${dash.arrivals?.length}  departures: ${dash.departures?.length}  inHouse: ${dash.inHouse ?? dash.inHouseCount}  pending: ${dash.pendingCount ?? dash.pending?.length ?? dash.pendingApprovals}`);
const revenue = (await api('GET', '/finance/revenue?from=2026-07-01&to=2026-07-31', { token })).body;
console.log(`  July approvedGross: Rs ${revenue.approvedGross}`);
const reviews = (await api('GET', '/reviews', { token })).body;
console.log(`  reviews: ${reviews.reviews?.length ?? reviews.length}`);
console.log('\nALL DEMO DATA READY ✓');
