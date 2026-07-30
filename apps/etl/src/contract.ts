/**
 * The legacy schema surface this ETL depends on — every table and column it reads, declared once.
 *
 * WHY THIS EXISTS. There is no mysqldump of the production database available. The only schema
 * artefact on disk (`backend-portal/database.sql`) is explicitly headed "Generated from codebase
 * analysis" — a *reconstruction*, and a provably incomplete one: `selling_price` (the date-range
 * table TopDown properties price from, read by `convertTopDownSellingPricesToSellingPrices` in
 * `extranet/app/Custom/Helper/Util.php`) does not appear in it at all.
 *
 * So the ETL must not assume the reconstruction is true. This file states its assumptions
 * explicitly and `discover.ts` checks them against the real database before a single row moves.
 * A missing column surfaces as a report line, not as a silent NULL in a migrated booking.
 *
 * `optional: true` marks a column the ETL can work without (it degrades to a documented default).
 * Everything else is required: if it is absent, migration must not proceed.
 */

export interface ColumnContract {
  name: string;
  /** Why the ETL reads it — shown in the discovery report so a mismatch is actionable. */
  purpose: string;
  optional?: boolean;
}

export interface TableContract {
  table: string;
  /** What this table becomes in 2.0. */
  mapsTo: string;
  columns: ColumnContract[];
  /** Set when the table is known NOT to be in the reconstructed dump — expect surprises. */
  unverified?: boolean;
  notes?: string;
}

export const LEGACY_CONTRACT: TableContract[] = [
  {
    table: 'propertyowners',
    mapsTo: 'tenants + users + memberships (one owner = one tenant, OWNER role)',
    columns: [
      { name: 'id', purpose: 'identity, mapped via etl_id_map' },
      { name: 'name', purpose: 'tenants.name' },
      { name: 'email', purpose: 'tenants.email + users.email (login identity)' },
      {
        name: 'password',
        purpose: 'NOT migrated — every owner gets a password reset',
        optional: true,
      },
      { name: 'status', purpose: 'tenants.status (Active→active, else inactive)', optional: true },
      { name: 'created_at', purpose: 'tenants.created_at', optional: true },
    ],
    notes:
      'Legacy passwords are bcrypt from Laravel and COULD be carried over, but the cutover ' +
      'deliberately forces a reset: it is the only way to guarantee no legacy admin backdoor ' +
      'survives (the backdoor was killed in Phase 1).',
  },
  {
    table: 'properties',
    mapsTo: 'properties',
    columns: [
      { name: 'id', purpose: 'identity' },
      { name: 'propertyowner_id', purpose: 'tenant resolution — the tenancy spine' },
      { name: 'name', purpose: 'properties.name' },
      { name: 'actual_name', purpose: 'fallback when name is a marketing alias', optional: true },
      { name: 'status', purpose: 'Active/Inactive/Suspend — inactive properties still migrate' },
      {
        name: 'pricing_type',
        purpose: "ENUM('TopDown','BottomUp') — decides which calendar source to read",
      },
      { name: 'commissionstructure_id', purpose: 'resolves percentage vs slab commission' },
      { name: 'currency', purpose: 'properties.currency (base currency)', optional: true },
      { name: 'created_at', purpose: 'properties.created_at', optional: true },
    ],
  },
  {
    table: 'rooms',
    mapsTo: 'rooms',
    columns: [
      { name: 'id', purpose: 'identity' },
      { name: 'property_id', purpose: 'parent property' },
      { name: 'display_name', purpose: 'rooms.name' },
      { name: 'quantity', purpose: 'rooms.quantity — the physical ceiling inventory clamps to' },
      { name: 'roomtype_id', purpose: 'rooms.roomtype_id via the roomtypes map', optional: true },
      { name: 'status', purpose: 'Active/Inactive', optional: true },
    ],
  },
  {
    table: 'rateplans',
    mapsTo: 'rate_plans',
    columns: [
      { name: 'id', purpose: 'identity' },
      { name: 'room_id', purpose: 'parent room', optional: true },
      { name: 'ratecode_id', purpose: 'meal plan (RO/BB/HB/FB/AI) via rate_codes' },
    ],
  },
  {
    table: 'occupancies',
    mapsTo: 'occupancies',
    columns: [
      { name: 'id', purpose: 'identity' },
      { name: 'accomadates', purpose: 'occupancies.accommodates — NOTE the legacy misspelling' },
    ],
    notes:
      'The misspelling `accomadates` is REAL and load-bearing — legacy queries it as a SQL column ' +
      "(RatesAndAvailability.php:1413 max('occupancies.accomadates'), RateService.php:61). The " +
      'reconstructed dump instead shows name/code/value for this table, which is one of the ' +
      'places it is demonstrably wrong. Trust the code here, and confirm against a real dump.',
  },
  {
    table: 'occupancy_rateplan',
    mapsTo: 'occupancies (the join IS the pricing key)',
    columns: [
      { name: 'id', purpose: 'THE pricing key — legacy BUG #2 was using room_id in its place' },
      { name: 'rateplan_id', purpose: 'parent rate plan' },
      { name: 'occupancy_id', purpose: 'parent occupancy' },
    ],
    notes:
      'occupancy_rateplan.id is what prices and bookings actually key on. Getting this mapping ' +
      'right is the whole reason BUG #2 stayed fixed.',
  },
  {
    table: 'sellingprices',
    mapsTo: 'rate_calendar (BottomUp properties)',
    columns: [
      { name: 'occupancy_rateplan_id', purpose: 'pricing key' },
      { name: 'date', purpose: 'the night' },
      { name: 'price', purpose: 'the stored selling price for that night' },
    ],
  },
  {
    table: 'selling_price',
    mapsTo: 'rate_calendar (TopDown properties, expanded to one row per night)',
    unverified: true,
    columns: [
      { name: 'occupancy_rateplan_id', purpose: 'pricing key' },
      { name: 'start_date', purpose: 'range start — expanded per-night by the ETL' },
      { name: 'end_date', purpose: 'range end' },
      { name: 'selling_price', purpose: 'the selling price across the range' },
    ],
    notes:
      'SINGULAR table name, and absent from the reconstructed dump — schema unknown until ' +
      'discovery runs. This is the TopDown source the locked decision unifies to per-day.',
  },
  {
    table: 'pricecalendars',
    mapsTo: 'availability_calendar (rooms_to_sell + status)',
    columns: [
      { name: 'room_id', purpose: 'the room' },
      { name: 'date', purpose: 'the night' },
      { name: 'rooms_to_sell', purpose: 'availability_calendar.rooms_to_sell' },
      { name: 'status', purpose: 'Open/Closed → availability_calendar.status' },
      { name: 'open_rooms', purpose: 'cross-check against rooms_to_sell', optional: true },
    ],
  },
  {
    table: 'customers',
    mapsTo: 'customers',
    columns: [
      { name: 'id', purpose: 'identity' },
      { name: 'name', purpose: 'customers.name', optional: true },
      { name: 'email', purpose: 'customers.email — the dedupe key', optional: true },
      { name: 'mobile', purpose: 'customers.phone (legacy calls it `mobile`)', optional: true },
    ],
    notes:
      'The phone column is `mobile`, not `phone` — confirmed in code: ' +
      "BookingsController.php:104 does Customer::where('mobile', ...) and stores a calling-code " +
      'prefixed number. Legacy also looks customers up by mobile suffix, so numbers are not ' +
      'normalised and may need cleaning during migration.',
  },
  {
    table: 'bookings',
    mapsTo: 'bookings',
    columns: [
      { name: 'id', purpose: 'identity' },
      { name: 'reference', purpose: 'bookings.reference — carried over verbatim, it is unique' },
      { name: 'room_id', purpose: 'the room booked' },
      { name: 'customer_id', purpose: 'the guest' },
      { name: 'occupancy_rateplan_id', purpose: 'THE pricing key (BUG #2)' },
      { name: 'checkin', purpose: 'bookings.checkin' },
      { name: 'checkout', purpose: 'bookings.checkout' },
      { name: 'rooms', purpose: 'rooms booked' },
      { name: 'amount', purpose: 'gross charged — the parity harness recomputes this' },
      { name: 'total_base_price', purpose: 'owner base — parity input' },
      {
        name: 'total_system_base_price',
        purpose: 'the OTHER base figure; the TopDown/BottomUp inconsistency lives here',
        optional: true,
      },
      { name: 'commission', purpose: 'yoho commission — parity input' },
      { name: 'commission_ota', purpose: 'OTA commission — parity input' },
      { name: 'taxes', purpose: 'tax total — parity input' },
      { name: 'status', purpose: 'Approved/Pending/Rejected/Cancelled/No show' },
      { name: 'checked_in', purpose: 'flag → CheckedIn status (2.0 models it as a status)' },
      { name: 'checked_out', purpose: 'flag → CheckedOut status' },
      { name: 'currency', purpose: 'bookings.currency', optional: true },
      { name: 'source', purpose: 'bookings.source (Extranet/OTA/Backend)', optional: true },
      { name: 'created_at', purpose: 'bookings.created_at', optional: true },
    ],
  },
  {
    table: 'dailyrates',
    mapsTo: 'booking_days (the per-night price snapshot)',
    columns: [
      { name: 'booking_id', purpose: 'parent booking' },
      { name: 'date', purpose: 'the night' },
      { name: 'rate', purpose: 'the charged rate for that night' },
    ],
    notes:
      'This is the closest legacy analogue to booking_days. It carries only the rate, so the ' +
      'base/commission/tax split per night has to be re-derived — which is exactly what the ' +
      'parity harness verifies.',
  },
];

/** Every table the ETL reads, in dependency order. */
export const CONTRACT_TABLES = LEGACY_CONTRACT.map((t) => t.table);

export function tableContract(table: string): TableContract | undefined {
  return LEGACY_CONTRACT.find((t) => t.table === table);
}
