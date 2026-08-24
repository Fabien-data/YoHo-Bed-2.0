import type { CurrencyCode } from '@yohobed/domain';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const TOKEN_KEY = 'yoho_token';
const USER_KEY = 'yoho_user';

export interface Membership {
  tenantId: string | null;
  role: string;
  tenantStatus?: string | null;
}
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  memberships: Membership[];
}

export interface Property {
  id: string;
  name: string;
  /** Base currency the property prices/settles in (LKR or USD). */
  currency?: CurrencyCode;
}

export interface Room {
  id: string;
  propertyId: string;
  name: string;
  quantity: number;
}

export interface AvailabilityDay {
  id: string;
  roomId: string;
  date: string;
  physicalQuantity: number;
  roomsToSell: number;
  status: 'Open' | 'Close';
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function getUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}
export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // An expired or invalid token used to leave the user stranded: the app still considered them
    // signed in because a token STRING was in localStorage, so every screen rendered its shell and
    // then showed "Invalid or expired token" instead of sending them to the login page. Presence
    // of a token is not the same as validity, and only the server can tell the difference — so the
    // server's answer is what ends the session.
    //
    // Guarded on `token`: a 401 from the login endpoint itself means wrong credentials, and must
    // surface as an error message rather than a redirect loop.
    if (res.status === 401 && token && typeof window !== 'undefined') {
      clearSession();
      window.location.replace('/?expired=1');
    }
    const message = (data && (data.message || data.reason)) || res.statusText || 'Request failed';
    throw new ApiError(res.status, Array.isArray(message) ? message.join(', ') : message, data);
  }
  return data as T;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const data = await apiFetch<{ accessToken: string; user: SessionUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem(TOKEN_KEY, data.accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.user;
}

export function register(body: {
  ownerName: string;
  businessName: string;
  email: string;
  password: string;
}): Promise<{ tenantId: string; status: string; message: string }> {
  return apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(body) });
}

export function forgotPassword(email: string): Promise<{ message: string }> {
  return apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
}

export function resetPassword(token: string, password: string): Promise<{ message: string }> {
  return apiFetch('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ message: string }> {
  return apiFetch('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

// --- Profile (Compartment H) ---------------------------------------------------

export interface PayoutAccount {
  id: string;
  bankName: string;
  branchName: string | null;
  accountName: string;
  accountNumber: string;
  swiftCode: string | null;
  currency: string;
}
export interface Profile {
  user: { id: string; email: string; name: string };
  tenant: {
    id: string;
    name: string;
    email: string;
    status: 'pending' | 'active' | 'inactive' | 'suspended';
    agreementAcceptedAt: string | null;
  };
  payoutAccount: PayoutAccount | null;
}

export function getProfile(): Promise<Profile> {
  return apiFetch<Profile>('/profile');
}
export function setPayoutAccount(body: {
  bankName: string;
  branchName?: string;
  accountName: string;
  accountNumber: string;
  swiftCode?: string;
}): Promise<PayoutAccount> {
  return apiFetch('/profile/payout-account', { method: 'PUT', body: JSON.stringify(body) });
}
export function acceptAgreement(): Promise<{ agreementAcceptedAt: string }> {
  return apiFetch('/profile/agreement/accept', { method: 'POST' });
}

// --- Photos (Compartment H) ----------------------------------------------------

export interface Photo {
  id: string;
  propertyId: string | null;
  roomId: string | null;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
}

export function mediaUrl(storageKey: string): string {
  return `${API_BASE}/media/${storageKey}`;
}

async function apiUpload<T>(path: string, file: File): Promise<T> {
  const token = getToken();
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.message) || res.statusText, data);
  }
  return data as T;
}

export function uploadPropertyPhoto(propertyId: string, file: File): Promise<Photo> {
  return apiUpload(`/properties/${propertyId}/photos`, file);
}
export function uploadRoomPhoto(roomId: string, file: File): Promise<Photo> {
  return apiUpload(`/rooms/${roomId}/photos`, file);
}
export function listPropertyPhotos(propertyId: string): Promise<Photo[]> {
  return apiFetch<Photo[]>(`/properties/${propertyId}/photos`);
}
export function listRoomPhotos(roomId: string): Promise<Photo[]> {
  return apiFetch<Photo[]>(`/rooms/${roomId}/photos`);
}
export function deletePhoto(id: string): Promise<{ deleted: boolean }> {
  return apiFetch(`/photos/${id}`, { method: 'DELETE' });
}

export function listProperties(): Promise<Property[]> {
  return apiFetch<Property[]>('/properties');
}

export function createProperty(name: string): Promise<Property> {
  return apiFetch<Property>('/properties', { method: 'POST', body: JSON.stringify({ name }) });
}

export function listRooms(): Promise<Room[]> {
  return apiFetch<Room[]>('/rooms');
}

export function createRoom(propertyId: string, name: string, quantity: number): Promise<Room> {
  return apiFetch<Room>(`/properties/${propertyId}/rooms`, {
    method: 'POST',
    body: JSON.stringify({ name, quantity }),
  });
}

export function openAvailability(
  roomId: string,
  from: string,
  to: string,
  roomsToSell: number,
  status: 'Open' | 'Close' = 'Open',
): Promise<{ opened: number }> {
  return apiFetch(`/rooms/${roomId}/availability`, {
    method: 'POST',
    body: JSON.stringify({ from, to, roomsToSell, status }),
  });
}

export function getAvailability(
  roomId: string,
  from: string,
  to: string,
): Promise<AvailabilityDay[]> {
  return apiFetch<AvailabilityDay[]>(`/rooms/${roomId}/availability?from=${from}&to=${to}`);
}

export interface RateDay {
  date: string;
  occupancyId: string;
  basePrice: string;
  commission: string;
  sellingPrice: string;
  lastMinuteDropPct: string;
  effectiveSelling: string;
  rateCode: string;
  accommodates: number;
}

export interface RateCode {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
}

export interface RatePlan {
  id: string;
  roomId: string;
  rateCodeId: string;
  code: string;
  name: string;
  status: 'Active' | 'Inactive';
}

export interface Occupancy {
  id: string;
  ratePlanId: string;
  label: string;
  accommodates: number;
}

export interface Season {
  id: string;
  propertyId: string;
  name: string;
  startDate: string;
  endDate: string;
}

export function getRoomRates(roomId: string, from: string, to: string): Promise<RateDay[]> {
  return apiFetch<RateDay[]>(`/rooms/${roomId}/rates?from=${from}&to=${to}`);
}

export function setPrice(
  occupancyId: string,
  from: string,
  to: string,
  base: number,
): Promise<{ updated: number; selling: number; commission: number }> {
  return apiFetch(`/occupancies/${occupancyId}/price`, {
    method: 'POST',
    body: JSON.stringify({ from, to, base }),
  });
}

export function listRateCodes(): Promise<RateCode[]> {
  return apiFetch<RateCode[]>('/rate-codes');
}

export function listRatePlans(roomId: string): Promise<RatePlan[]> {
  return apiFetch<RatePlan[]>(`/rooms/${roomId}/rate-plans`);
}

export function createRatePlan(roomId: string, rateCodeId: string): Promise<RatePlan> {
  return apiFetch<RatePlan>(`/rooms/${roomId}/rate-plans`, {
    method: 'POST',
    body: JSON.stringify({ rateCodeId }),
  });
}

export function listOccupancies(ratePlanId: string): Promise<Occupancy[]> {
  return apiFetch<Occupancy[]>(`/rate-plans/${ratePlanId}/occupancies`);
}

export function createOccupancy(
  ratePlanId: string,
  label: string,
  accommodates: number,
): Promise<Occupancy> {
  return apiFetch<Occupancy>(`/rate-plans/${ratePlanId}/occupancies`, {
    method: 'POST',
    body: JSON.stringify({ label, accommodates }),
  });
}

export function listSeasons(propertyId: string): Promise<Season[]> {
  return apiFetch<Season[]>(`/properties/${propertyId}/seasons`);
}

export function createSeason(
  propertyId: string,
  name: string,
  from: string,
  to: string,
): Promise<Season> {
  return apiFetch<Season>(`/properties/${propertyId}/seasons`, {
    method: 'POST',
    body: JSON.stringify({ name, from, to }),
  });
}

export function applySeason(
  seasonId: string,
  prices: { occupancyId: string; base: number }[],
): Promise<{ season: string; from: string; to: string; occupancies: number }> {
  return apiFetch(`/seasons/${seasonId}/apply`, {
    method: 'POST',
    body: JSON.stringify({ prices }),
  });
}

export function setLastMinuteDrop(
  occupancyId: string,
  from: string,
  to: string,
  dropPct: number,
): Promise<{ updated: number }> {
  return apiFetch(`/occupancies/${occupancyId}/last-minute-drop`, {
    method: 'POST',
    body: JSON.stringify({ from, to, dropPct }),
  });
}

export function reserve(roomId: string, checkin: string, checkout: string, rooms = 1) {
  return apiFetch(`/rooms/${roomId}/reserve`, {
    method: 'POST',
    body: JSON.stringify({ checkin, checkout, rooms }),
  });
}

export function release(roomId: string, checkin: string, checkout: string, rooms = 1) {
  return apiFetch(`/rooms/${roomId}/release`, {
    method: 'POST',
    body: JSON.stringify({ checkin, checkout, rooms }),
  });
}

export type BookingStatus =
  'Pending' | 'Approved' | 'CheckedIn' | 'CheckedOut' | 'Rejected' | 'Cancelled' | 'NoShow';

export interface Booking {
  id: string;
  reference: string;
  status: BookingStatus;
  source: string;
  checkin: string;
  checkout: string;
  nights: number;
  rooms: number;
  amount: string;
  currency?: CurrencyCode;
  roomId: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
}

export function listBookings(): Promise<Booking[]> {
  return apiFetch<Booking[]>('/bookings');
}

export function createBooking(body: {
  roomId: string;
  occupancyId: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  checkin: string;
  checkout: string;
  rooms?: number;
  couponCode?: string;
  referralCode?: string;
}): Promise<{ id: string; reference: string; amount: string; currency?: CurrencyCode }> {
  return apiFetch('/bookings', { method: 'POST', body: JSON.stringify(body) });
}

export function bookingTransition(
  id: string,
  action: 'approve' | 'reject' | 'cancel' | 'no-show' | 'check-in' | 'check-out',
): Promise<Booking> {
  return apiFetch(`/bookings/${id}/${action}`, {
    method: 'POST',
    body: action === 'reject' ? JSON.stringify({}) : undefined,
  });
}

export function amendBooking(
  id: string,
  body: {
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    checkin?: string;
    checkout?: string;
    rooms?: number;
  },
): Promise<Booking> {
  return apiFetch(`/bookings/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// --- Dashboard (Compartment G) ------------------------------------------------

export interface DashboardBooking {
  id: string;
  reference: string;
  status: BookingStatus;
  source: string;
  checkin: string;
  checkout: string;
  nights: number;
  rooms: number;
  amount: string;
  currency?: CurrencyCode;
  customerName: string;
  roomName: string;
}

export interface DashboardOverview {
  date: string;
  arrivals: DashboardBooking[];
  departures: DashboardBooking[];
  inHouse: number;
  pendingApprovals: number;
  occupancy: { totalRooms: number; occupied: number; pct: number };
  month: {
    from: string;
    gross: number;
    nightsSold: number;
    currency?: CurrencyCode;
    /** True when the figure spans base currencies and was consolidated — label it as an estimate. */
    approximate?: boolean;
  };
  recent: DashboardBooking[];
}

export function getDashboard(date?: string, propertyId?: string): Promise<DashboardOverview> {
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (propertyId) params.set('propertyId', propertyId);
  const qs = params.toString();
  return apiFetch<DashboardOverview>(`/dashboard${qs ? `?${qs}` : ''}`);
}

export interface PayoutStatement {
  propertyId: string;
  currency?: CurrencyCode;
  from: string;
  to: string;
  bookingCount: number;
  grossSelling: number;
  propertyBase: number;
  yohoCommission: number;
  otaCommission: number;
  taxes: number;
  netPayable: number;
}

export function getPayoutStatement(
  propertyId: string,
  from: string,
  to: string,
): Promise<PayoutStatement> {
  return apiFetch<PayoutStatement>(
    `/finance/payout-statement?propertyId=${propertyId}&from=${from}&to=${to}`,
  );
}

export interface Revenue {
  from: string;
  to: string;
  byStatus: Record<string, { count: number; gross: number }>;
  approvedGross: number;
  totalBookings: number;
  /** Denomination of the gross figures — native when the tenant prices in one currency. */
  currency?: CurrencyCode;
  /** True when properties price in different currencies and totals were consolidated to LKR. */
  approximate?: boolean;
}

export function getRevenue(from: string, to: string): Promise<Revenue> {
  return apiFetch<Revenue>(`/finance/revenue?from=${from}&to=${to}`);
}

// --- Exchange rates (multi-currency display) ---------------------------------

export interface FxRate {
  base: string;
  /** 1 base = rate LKR. Null until a rate exists for that currency. */
  rate: number | null;
  source: string | null;
  fetchedAt: string | null;
  symbol: string;
}
export interface FxRates {
  quote: string;
  rates: FxRate[];
}
export function getFxRates(): Promise<FxRates> {
  return apiFetch<FxRates>('/fx/rates');
}

// --- Stay view (the tape chart) ---------------------------------------------

export interface StayBar {
  kind: 'booking' | 'block';
  id: string;
  from: string;
  /** Exclusive — the guest is gone on this date. */
  to: string;
  bookingId?: string;
  reference?: string;
  guestName?: string;
  status?: string;
  source?: string;
  channel?: string | null;
  groupId?: string | null;
  balanceDue?: boolean;
  reason?: string;
}

export interface StayUnit {
  id: string;
  roomId: string;
  code: string;
  floor: string | null;
  status: 'active' | 'inactive';
  bars: StayBar[];
}

export interface StayRoomType {
  roomId: string;
  name: string;
  quantity: number;
  perDate: Array<{ date: string; available: number | null; closed: boolean; rate: string | null }>;
  units: StayUnit[];
}

export interface StayFooter {
  date: string;
  soldRooms: number;
  blocked: number;
  availableInventory: number;
  totalRooms: number;
  occupancyPct: number;
}

export interface StayView {
  property: { id: string; name: string; code: string | null; currency: string };
  from: string;
  to: string;
  dates: string[];
  roomTypes: StayRoomType[];
  unassigned: Array<StayBar & { roomId: string }>;
  footer: StayFooter[];
  counts: {
    all: number;
    vacant: number;
    occupied: number;
    reserved: number;
    blocked: number;
    dueOut: number;
  };
}

export function getStayView(propertyId: string, from: string, to: string): Promise<StayView> {
  return apiFetch<StayView>(`/stayview?propertyId=${propertyId}&from=${from}&to=${to}`);
}

export interface BookingLeg {
  id: string;
  legIndex: number;
  roomUnitId: string | null;
  code: string | null;
  checkin: string;
  checkout: string;
  adults: number;
  children: number;
  releasedAt: string | null;
}

export function getBookingLegs(bookingId: string): Promise<BookingLeg[]> {
  return apiFetch<BookingLeg[]>(`/bookings/${bookingId}/rooms`);
}

export function assignRooms(
  bookingId: string,
  assignments: Array<{ legId: string; roomUnitId: string | null }>,
): Promise<BookingLeg[]> {
  return apiFetch<BookingLeg[]>(`/bookings/${bookingId}/assign`, {
    method: 'POST',
    body: JSON.stringify({ assignments }),
  });
}

export function autoAssignRooms(
  bookingId: string,
): Promise<{ assigned: number; unassigned: number; legs: BookingLeg[] }> {
  return apiFetch(`/bookings/${bookingId}/auto-assign`, { method: 'POST' });
}

export interface RoomUnit {
  id: string;
  propertyId: string;
  roomId: string;
  roomName: string;
  code: string;
  displayOrder: number;
  floor: string | null;
  notes: string | null;
  status: 'active' | 'inactive';
}

export function listRoomUnits(propertyId: string): Promise<RoomUnit[]> {
  return apiFetch<RoomUnit[]>(`/properties/${propertyId}/room-units`);
}

export function createBlock(
  propertyId: string,
  body: { roomUnitId: string; blockFrom: string; blockTo: string; reason: string },
): Promise<unknown> {
  return apiFetch(`/properties/${propertyId}/blocks`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateBlock(
  id: string,
  body: { blockFrom?: string; blockTo?: string; reason?: string },
): Promise<unknown> {
  return apiFetch(`/blocks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function releaseBlock(id: string): Promise<unknown> {
  return apiFetch(`/blocks/${id}/release`, { method: 'POST' });
}

// --- Room View / housekeeping ------------------------------------------------

export type RoomState = 'OutOfOrder' | 'Occupied' | 'PendingCheckout' | 'ArrivingToday' | 'Vacant';
export type HousekeepingState = 'dirty' | 'clean' | 'inspected' | 'out_of_order';

export interface RoomCard {
  unitId: string;
  code: string;
  roomId: string;
  roomName: string;
  floor: string | null;
  unitStatus: 'active' | 'inactive';
  state: RoomState;
  housekeeping: HousekeepingState;
  remarks: string | null;
  assignedTo: string | null;
  guestName: string | null;
  bookingId: string | null;
  reference: string | null;
  checkin: string | null;
  checkout: string | null;
  vip: boolean;
  balanceDue: boolean;
  adults: number | null;
  children: number | null;
  source: string | null;
  blockReason: string | null;
  openWorkOrders: number;
}

export interface HouseSummary {
  all: number;
  vacant: number;
  occupied: number;
  arriving: number;
  pendingCheckout: number;
  outOfOrder: number;
  dirty: number;
  clean: number;
  inspected: number;
}

export function getRoomView(propertyId: string, date: string): Promise<RoomCard[]> {
  return apiFetch<RoomCard[]>(`/room-view?propertyId=${propertyId}&date=${date}`);
}

export function getHouseSummary(propertyId: string, date: string): Promise<HouseSummary> {
  return apiFetch<HouseSummary>(`/house-status/summary?propertyId=${propertyId}&date=${date}`);
}

export function setHousekeeping(
  propertyId: string,
  body: {
    roomUnitId: string;
    date: string;
    status: HousekeepingState;
    remarks?: string;
  },
): Promise<unknown> {
  return apiFetch(`/properties/${propertyId}/housekeeping`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function markDeparturesDirty(propertyId: string, date: string): Promise<{ marked: number }> {
  return apiFetch(`/properties/${propertyId}/housekeeping/mark-departures-dirty?date=${date}`, {
    method: 'POST',
  });
}

export interface WorkOrder {
  id: string;
  roomUnitId: string | null;
  code: string | null;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  assignedToName: string | null;
  deadline: string | null;
  completedAt: string | null;
  createdAt: string;
}

export function listWorkOrders(propertyId: string): Promise<WorkOrder[]> {
  return apiFetch<WorkOrder[]>(`/properties/${propertyId}/work-orders`);
}

export function createWorkOrder(
  propertyId: string,
  body: {
    roomUnitId?: string;
    title: string;
    description?: string;
    priority?: WorkOrder['priority'];
    deadline?: string;
  },
): Promise<WorkOrder> {
  return apiFetch(`/properties/${propertyId}/work-orders`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateWorkOrder(
  id: string,
  body: Partial<Pick<WorkOrder, 'title' | 'priority' | 'status'>>,
): Promise<WorkOrder> {
  return apiFetch(`/work-orders/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// --- Reservations screen -----------------------------------------------------

export type ReservationTab = 'all' | 'arrivals' | 'departures' | 'inhouse' | 'cancelled';

export interface ReservationRow {
  id: string;
  reference: string;
  status: string;
  source: string;
  channel: string | null;
  checkin: string;
  checkout: string;
  nights: number;
  rooms: number;
  amount: string;
  currency: string;
  groupId: string | null;
  groupCode: string | null;
  groupName: string | null;
  customerId: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  vip: boolean;
  roomCodes: string[];
  balanceDue: boolean;
  createdAt: string;
}

export interface ReservationList {
  date: string;
  tab: ReservationTab;
  counts: Record<ReservationTab, number>;
  rows: ReservationRow[];
}

export function getReservations(params: {
  propertyId: string;
  date: string;
  tab?: ReservationTab;
  q?: string;
  groupsOnly?: boolean;
}): Promise<ReservationList> {
  const sp = new URLSearchParams({ propertyId: params.propertyId, date: params.date });
  if (params.tab) sp.set('tab', params.tab);
  if (params.q) sp.set('q', params.q);
  if (params.groupsOnly) sp.set('groupsOnly', 'true');
  return apiFetch<ReservationList>(`/reservations?${sp.toString()}`);
}

export interface BookingGroup {
  id: string;
  code: string;
  name: string | null;
  memberCount: number;
  total: string;
  members: Array<{
    id: string;
    reference: string;
    status: string;
    checkin: string;
    checkout: string;
    rooms: number;
    amount: string;
    currency: string;
    guestName: string;
  }>;
}

export function makeBookingGroup(
  propertyId: string,
  body: { bookingIds: string[]; name?: string; force?: boolean },
): Promise<BookingGroup> {
  return apiFetch(`/properties/${propertyId}/booking-groups`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getBookingGroup(id: string): Promise<BookingGroup> {
  return apiFetch(`/booking-groups/${id}`);
}

export function mergeBookingGroup(id: string, bookingIds: string[]): Promise<BookingGroup> {
  return apiFetch(`/booking-groups/${id}/merge`, {
    method: 'POST',
    body: JSON.stringify({ bookingIds }),
  });
}

export function leaveBookingGroup(bookingId: string): Promise<unknown> {
  return apiFetch(`/bookings/${bookingId}/group`, { method: 'DELETE' });
}

export interface RegistrationCard {
  reference: string;
  status: string;
  source: string;
  checkin: string;
  checkout: string;
  nights: number;
  rooms: number;
  amount: string;
  taxes: string;
  currency: string;
  guest: {
    name: string;
    email: string | null;
    phone: string | null;
    nationality: string | null;
    idType: string | null;
    idNumber: string | null;
    dateOfBirth: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    vip: boolean;
  };
  property: {
    name: string;
    code: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
    checkinTime: string | null;
    checkoutTime: string | null;
  };
  legs: Array<{ legIndex: number; code: string | null; adults: number; children: number }>;
}

export function getRegistrationCard(bookingId: string): Promise<RegistrationCard> {
  return apiFetch(`/bookings/${bookingId}/registration-card`);
}

export interface GuestProfile {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  idType: string | null;
  idNumber: string | null;
  dateOfBirth: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  vip: boolean;
  notes: string | null;
}

export function updateCustomer(
  id: string,
  body: Partial<Omit<GuestProfile, 'id'>>,
): Promise<GuestProfile> {
  return apiFetch(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// --- Folio (the guest bill) --------------------------------------------------

export interface FolioLine {
  id: string;
  source: 'room' | 'manual' | 'pos';
  description: string;
  postedFor: string;
  bookingDate: string | null;
  quantity: string;
  unitPrice: string;
  net: string;
  tax: string;
  total: string;
  voidedAt: string | null;
  voidReason: string | null;
  particularCode: string | null;
}

export interface FolioPaymentRow {
  id: string;
  amount: string;
  method: string;
  reference: string | null;
  createdAt: string;
}

export interface FolioWindow {
  id: string;
  window: number;
  label: string;
  status: 'open' | 'closed' | 'void';
  currency: string;
  lines: FolioLine[];
  payments: FolioPaymentRow[];
  totals: { charges: string; tax: string; paid: string; balance: string };
}

export interface BookingFolio {
  bookingId: string;
  reference: string;
  guestName: string;
  status: string;
  currency: string;
  checkin: string;
  checkout: string;
  rooms: number;
  bookingAmount: string;
  windows: FolioWindow[];
  totals: { charges: string; paid: string; balance: string };
}

export function getBookingFolio(bookingId: string): Promise<BookingFolio> {
  return apiFetch<BookingFolio>(`/bookings/${bookingId}/folio`);
}

export function postRoomCharges(
  bookingId: string,
): Promise<{ posted: number; skipped: number; folioId: string }> {
  return apiFetch(`/bookings/${bookingId}/folio/post-room-charges`, { method: 'POST' });
}

export function openFolioWindow(bookingId: string, label?: string): Promise<FolioWindow> {
  return apiFetch(`/bookings/${bookingId}/folio/windows`, {
    method: 'POST',
    body: JSON.stringify({ label }),
  });
}

export function postFolioCharge(
  folioId: string,
  body: {
    particularId?: string;
    description?: string;
    unitPrice?: number;
    quantity?: number;
    taxRatePct?: number;
    taxInclusive?: boolean;
  },
): Promise<FolioLine> {
  return apiFetch(`/folios/${folioId}/charges`, { method: 'POST', body: JSON.stringify(body) });
}

export function voidFolioCharge(chargeId: string, reason?: string): Promise<FolioLine> {
  return apiFetch(`/folio-charges/${chargeId}/void`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function transferFolioCharges(body: {
  chargeIds: string[];
  toFolioId: string;
  reason?: string;
}): Promise<FolioWindow> {
  return apiFetch('/folio-charges/transfer', { method: 'POST', body: JSON.stringify(body) });
}

export function recordFolioPayment(
  folioId: string,
  body: { amount: number; method?: string; reference?: string },
): Promise<FolioPaymentRow> {
  return apiFetch(`/folios/${folioId}/payments`, { method: 'POST', body: JSON.stringify(body) });
}

export function closeFolioWindow(folioId: string, force = false): Promise<FolioWindow> {
  return apiFetch(`/folios/${folioId}/close${force ? '?force=true' : ''}`, { method: 'POST' });
}

export interface UnsettledFolio {
  folioId: string;
  window: number;
  label: string;
  bookingId: string;
  reference: string;
  status: string;
  checkin: string;
  checkout: string;
  currency: string;
  guestName: string;
  vip: boolean;
  charges: string;
  paid: string;
  balance: string;
  roomCodes: string[];
}

export function getUnsettledFolios(propertyId: string): Promise<UnsettledFolio[]> {
  return apiFetch<UnsettledFolio[]>(`/folios/unsettled?propertyId=${propertyId}`);
}

export interface ChargeParticular {
  id: string;
  code: string;
  name: string;
  category: string;
  defaultPrice: string;
  taxRatePct: string;
  taxInclusive: boolean;
  active: boolean;
}

export function listChargeParticulars(): Promise<ChargeParticular[]> {
  return apiFetch<ChargeParticular[]>('/charge-particulars');
}

export function createChargeParticular(body: {
  code: string;
  name: string;
  category?: string;
  defaultPrice?: number;
  taxRatePct?: number;
  taxInclusive?: boolean;
}): Promise<ChargeParticular> {
  return apiFetch('/charge-particulars', { method: 'POST', body: JSON.stringify(body) });
}

// --- Cashiering: city ledger, tills, expenses --------------------------------

export type LedgerAccountType = 'travel_agent' | 'company' | 'sales_person' | 'other';

export interface LedgerAccount {
  id: string;
  type: LedgerAccountType;
  code: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  creditLimit: string;
  currency: string;
  active: boolean;
  balance: string;
}

export interface LedgerStatement {
  account: LedgerAccount;
  balance: string;
  entries: Array<{
    id: string;
    direction: 'debit' | 'credit';
    amount: string;
    description: string;
    reference: string | null;
    bookingId: string | null;
    createdAt: string;
    balance: string;
  }>;
}

export function listLedgerAccounts(): Promise<LedgerAccount[]> {
  return apiFetch<LedgerAccount[]>('/ledger-accounts');
}

export function createLedgerAccount(body: {
  type?: LedgerAccountType;
  code: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  creditLimit?: number;
  currency?: string;
}): Promise<LedgerAccount> {
  return apiFetch('/ledger-accounts', { method: 'POST', body: JSON.stringify(body) });
}

export function getLedgerStatement(id: string): Promise<LedgerStatement> {
  return apiFetch(`/ledger-accounts/${id}/statement`);
}

export function settleLedgerAccount(
  id: string,
  body: { amount: number; description?: string; reference?: string },
): Promise<unknown> {
  return apiFetch(`/ledger-accounts/${id}/settle`, { method: 'POST', body: JSON.stringify(body) });
}

export function chargeFolioToLedger(
  folioId: string,
  body: { ledgerAccountId: string; amount: number; description?: string; reference?: string },
): Promise<unknown> {
  return apiFetch(`/folios/${folioId}/charge-to-ledger`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface BusinessSource {
  id: string;
  shortCode: string;
  name: string;
  color: string;
  active: boolean;
}

export function listBusinessSources(): Promise<BusinessSource[]> {
  return apiFetch<BusinessSource[]>('/business-sources');
}

export function createBusinessSource(body: {
  shortCode: string;
  name: string;
  color?: string;
}): Promise<BusinessSource> {
  return apiFetch('/business-sources', { method: 'POST', body: JSON.stringify(body) });
}

export interface CashDrawer {
  id: string;
  name: string;
  active: boolean;
  openSessionId: string | null;
}

export interface DrawerReport {
  session: {
    id: string;
    status: 'open' | 'closed';
    openingFloat: string;
    openedAt: string;
    declaredTotal: string | null;
    expectedTotal: string | null;
    variance: string | null;
    closedAt: string | null;
    notes: string | null;
  };
  totals: {
    openingFloat: string;
    cashTaken: string;
    cashPaidOut: string;
    expected: string;
    allPaymentsTaken: string;
    paymentCount: number;
    expenseCount: number;
    declared?: string | null;
    variance?: string | null;
  };
  byMethod: Array<{ method: string; total: string; n: number }>;
  expenses: Array<{
    id: string;
    voucherNo: string;
    category: string;
    payee: string;
    amount: string;
    createdAt: string;
  }>;
}

export function listDrawers(propertyId: string): Promise<CashDrawer[]> {
  return apiFetch<CashDrawer[]>(`/properties/${propertyId}/drawers`);
}

export function createDrawer(propertyId: string, name: string): Promise<CashDrawer> {
  return apiFetch(`/properties/${propertyId}/drawers`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function openDrawerSession(drawerId: string, openingFloat: number): Promise<unknown> {
  return apiFetch(`/drawers/${drawerId}/open`, {
    method: 'POST',
    body: JSON.stringify({ openingFloat }),
  });
}

export function getDrawerReport(sessionId: string): Promise<DrawerReport> {
  return apiFetch(`/drawer-sessions/${sessionId}/report`);
}

export function closeDrawerSession(
  sessionId: string,
  body: { declaredTotal: number; notes?: string },
): Promise<unknown> {
  return apiFetch(`/drawer-sessions/${sessionId}/close`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface ExpenseVoucher {
  id: string;
  voucherNo: string;
  category: string;
  payee: string;
  amount: string;
  currency: string;
  reference: string | null;
  note: string | null;
  drawerSessionId: string | null;
  createdAt: string;
  createdBy: string | null;
}

export function listExpenses(propertyId: string): Promise<ExpenseVoucher[]> {
  return apiFetch<ExpenseVoucher[]>(`/expenses?propertyId=${propertyId}`);
}

export function createExpense(
  propertyId: string,
  body: {
    drawerSessionId?: string;
    category?: string;
    payee: string;
    amount: number;
    reference?: string;
    note?: string;
  },
): Promise<ExpenseVoucher> {
  return apiFetch(`/properties/${propertyId}/expenses`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// --- Night audit -------------------------------------------------------------

export interface BusinessDate {
  propertyId: string;
  currentDate: string;
}

export interface AuditPreview {
  date: string;
  nextDate: string;
  roomsToCharge: number;
  chargesToPost: string;
  taxesToPost: string;
  noShows: string[];
}

export interface AuditRun {
  id: string;
  fromDate: string;
  toDate: string;
  roomsCharged: number;
  chargesPosted: string;
  taxesPosted: string;
  noShows: number;
  drawersClosed: number;
  summary: {
    roomsDue?: number;
    roomsPosted?: number;
    roomsSkipped?: number;
    noShowReferences?: string[];
  };
  runFromIp: string | null;
  runBy?: string | null;
  createdAt: string;
}

export function getBusinessDate(propertyId: string): Promise<BusinessDate> {
  return apiFetch(`/properties/${propertyId}/business-date`);
}

export function previewNightAudit(propertyId: string): Promise<AuditPreview> {
  return apiFetch(`/properties/${propertyId}/night-audit/preview`);
}

export function runNightAudit(propertyId: string): Promise<AuditRun> {
  return apiFetch(`/properties/${propertyId}/night-audit/run`, { method: 'POST' });
}

export function getNightAuditLog(propertyId: string): Promise<AuditRun[]> {
  return apiFetch(`/properties/${propertyId}/night-audit/log`);
}

export function getPostedRevenue(
  propertyId: string,
  from: string,
  to: string,
): Promise<{ from: string; to: string; nights: number; net: string; tax: string; total: string }> {
  return apiFetch(`/properties/${propertyId}/night-audit/revenue?from=${from}&to=${to}`);
}

// --- Subscription plan & entitlements ---------------------------------------

export interface CataloguePlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: string;
  currency: string;
  features: { features?: Record<string, boolean>; limits?: Record<string, number> };
}

export interface Entitlements {
  features: Record<string, boolean>;
  /** -1 means unlimited. */
  limits: Record<string, number>;
}

export interface TenantPlan {
  plan: {
    code: string;
    name: string;
    description: string | null;
    priceMonthly: string;
    currency: string;
  } | null;
  subscription: {
    status: 'trialing' | 'active' | 'past_due' | 'cancelled';
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    seats: number;
  } | null;
  distributionMode: 'yoho' | 'standalone';
  entitlements: Entitlements;
}

export function listPlans(): Promise<CataloguePlan[]> {
  return apiFetch<CataloguePlan[]>('/billing/plans');
}
export function getTenantPlan(): Promise<TenantPlan> {
  return apiFetch<TenantPlan>('/billing/plan');
}
export function getEntitlements(): Promise<Entitlements> {
  return apiFetch<Entitlements>('/billing/entitlements');
}

/** Human labels for the feature keys in @yohobed/domain — keep in step with FEATURE_KEYS. */
export const FEATURE_LABELS: Record<string, string> = {
  stay_view: 'Stay View',
  room_view: 'Room View',
  housekeeping: 'Housekeeping',
  work_orders: 'Work orders',
  folio: 'Guest folio',
  cashiering: 'Cashiering',
  pos: 'Point of sale',
  night_audit: 'Night audit',
  channel_manager: 'Channel manager',
  guest_messaging: 'Guest messaging',
  reports_advanced: 'Advanced reports',
  b2b_marketplace: 'B2B marketplace',
  ai_copilot: 'AI copilot',
  multi_property: 'Multiple properties',
};

export const LIMIT_LABELS: Record<string, string> = {
  max_properties: 'Properties',
  max_rooms: 'Rooms',
  max_users: 'Users',
};

// --- Staff console ----------------------------------------------------------

export function isStaff(user: SessionUser | null): boolean {
  return !!user?.memberships.some((m) => m.role === 'YOHO_STAFF' || m.role === 'YOHO_ADMIN');
}

export interface StaffTenant {
  id: string;
  name: string;
  email: string;
  status: 'pending' | 'active' | 'inactive' | 'suspended';
  pending: number;
}

export function listStaffTenants(): Promise<StaffTenant[]> {
  return apiFetch<StaffTenant[]>('/staff/tenants');
}

export function getStaffTenantBookings(tenantId: string): Promise<Booking[]> {
  return apiFetch<Booking[]>(`/staff/tenants/${tenantId}/bookings`);
}

export function staffBookingAction(
  tenantId: string,
  bookingId: string,
  action: 'approve' | 'reject',
): Promise<Booking> {
  return apiFetch(`/staff/tenants/${tenantId}/bookings/${bookingId}/${action}`, {
    method: 'POST',
    body: action === 'reject' ? JSON.stringify({}) : undefined,
  });
}

export function setTenantStatus(
  tenantId: string,
  status: 'active' | 'inactive' | 'suspended',
): Promise<StaffTenant> {
  return apiFetch(`/staff/tenants/${tenantId}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export interface StaffProperty {
  id: string;
  name: string;
  currency: CurrencyCode;
  /** Bookings recorded against this property — non-zero locks the base currency. */
  bookings: number;
  locked: boolean;
}

export function getStaffTenantProperties(tenantId: string): Promise<StaffProperty[]> {
  return apiFetch<StaffProperty[]>(`/staff/tenants/${tenantId}/properties`);
}

export function setPropertyCurrency(
  tenantId: string,
  propertyId: string,
  currency: 'LKR' | 'USD',
): Promise<StaffProperty> {
  return apiFetch(`/staff/tenants/${tenantId}/properties/${propertyId}/currency`, {
    method: 'POST',
    body: JSON.stringify({ currency }),
  });
}

export interface AuditEntry {
  id: string;
  tenantId: string | null;
  actorEmail: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  detail: unknown;
  createdAt: string;
}

export function getAudit(): Promise<AuditEntry[]> {
  return apiFetch<AuditEntry[]>('/staff/audit');
}

// --- Commercial (deals / coupons / referrals) --------------------------------

export interface Promotion {
  id: string;
  propertyId: string;
  name: string;
  discountPct: string;
  startDate: string;
  endDate: string;
  minNights: number;
  active: boolean;
}
export interface Coupon {
  id: string;
  propertyId: string | null;
  code: string;
  type: 'percentage' | 'fixed';
  value: string;
  startDate: string;
  endDate: string;
  maxUses: number;
  usedCount: number;
  active: boolean;
}
export interface ReferralPartner {
  id: string;
  name: string;
  code: string;
  commissionPct: string;
  active: boolean;
}
export interface ReferralCommission {
  id: string;
  amount: string;
  status: 'pending' | 'paid';
  createdAt: string;
  partnerName: string;
  bookingReference: string;
}

export function listPromotions(propertyId: string): Promise<Promotion[]> {
  return apiFetch<Promotion[]>(`/properties/${propertyId}/promotions`);
}
export function createPromotion(
  propertyId: string,
  body: { name: string; discountPct: number; from: string; to: string; minNights: number },
): Promise<Promotion> {
  return apiFetch(`/properties/${propertyId}/promotions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
export function applyPromotion(id: string): Promise<{ promotion: string; ratesUpdated: number }> {
  return apiFetch(`/promotions/${id}/apply`, { method: 'POST' });
}
export function deletePromotion(id: string): Promise<{ deleted: boolean }> {
  return apiFetch(`/promotions/${id}`, { method: 'DELETE' });
}

export function listCoupons(): Promise<Coupon[]> {
  return apiFetch<Coupon[]>('/coupons');
}
export function createCoupon(body: {
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  from: string;
  to: string;
  maxUses: number;
  propertyId?: string;
}): Promise<Coupon> {
  return apiFetch('/coupons', { method: 'POST', body: JSON.stringify(body) });
}
export function deleteCoupon(id: string): Promise<{ deleted: boolean }> {
  return apiFetch(`/coupons/${id}`, { method: 'DELETE' });
}

export function listReferralPartners(): Promise<ReferralPartner[]> {
  return apiFetch<ReferralPartner[]>('/referral-partners');
}
export function createReferralPartner(body: {
  name: string;
  code: string;
  commissionPct: number;
}): Promise<ReferralPartner> {
  return apiFetch('/referral-partners', { method: 'POST', body: JSON.stringify(body) });
}
export function deleteReferralPartner(id: string): Promise<{ deleted: boolean }> {
  return apiFetch(`/referral-partners/${id}`, { method: 'DELETE' });
}
export function listReferralCommissions(): Promise<ReferralCommission[]> {
  return apiFetch<ReferralCommission[]>('/referral-commissions');
}

// --- Communications ----------------------------------------------------------

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entity: string | null;
  entityId: string | null;
  read: boolean;
  createdAt: string;
}
export interface MessageLog {
  id: string;
  bookingId: string | null;
  channel: 'email' | 'sms';
  toAddress: string | null;
  templateKey: string;
  language: string;
  subject: string;
  body: string;
  status: 'queued' | 'sent' | 'failed';
  sentAt: string | null;
  createdAt: string;
}
export interface Template {
  id: string;
  key: string;
  language: string;
  channel: 'email' | 'sms';
  subject: string;
  body: string;
}
export interface Language {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
}

export function listNotifications(): Promise<AppNotification[]> {
  return apiFetch<AppNotification[]>('/notifications');
}
export function getUnreadCount(): Promise<{ count: number }> {
  return apiFetch<{ count: number }>('/notifications/unread-count');
}
export function markNotificationRead(id: string): Promise<{ read: boolean }> {
  return apiFetch(`/notifications/${id}/read`, { method: 'POST' });
}
export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return apiFetch('/notifications/read-all', { method: 'POST' });
}
export function listMessages(): Promise<MessageLog[]> {
  return apiFetch<MessageLog[]>('/messages');
}
export function listTemplates(): Promise<Template[]> {
  return apiFetch<Template[]>('/templates');
}
export function updateTemplate(
  id: string,
  body: { subject: string; body: string },
): Promise<Template> {
  return apiFetch(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export function listLanguages(): Promise<Language[]> {
  return apiFetch<Language[]>('/languages');
}

// --- OTA reservation inbox (Compartment F) ------------------------------------

export interface OtaReservation {
  id: string;
  channel: string;
  externalRef: string;
  guestName: string;
  guestEmail: string | null;
  checkin: string;
  checkout: string;
  rooms: number;
  otaAmount: string | null;
  status: 'received' | 'imported' | 'failed' | 'cancelled' | 'ignored';
  error: string | null;
  bookingId: string | null;
  roomId: string | null;
  receivedAt: string;
  processedAt: string | null;
}
export interface CmMapping {
  id: string;
  roomId: string;
  propertyId: string;
  code: string;
}

export function listOtaReservations(): Promise<OtaReservation[]> {
  return apiFetch<OtaReservation[]>('/ota/reservations');
}
export function retryOtaReservation(
  id: string,
): Promise<{ id: string; status: string; reference?: string; error?: string }> {
  return apiFetch(`/ota/reservations/${id}/retry`, { method: 'POST' });
}
export function listCmMappings(): Promise<CmMapping[]> {
  return apiFetch<CmMapping[]>('/ota/mappings');
}
export function setCmMapping(roomId: string, code: string): Promise<CmMapping> {
  return apiFetch('/ota/mappings', { method: 'PUT', body: JSON.stringify({ roomId, code }) });
}
export function simulateOta(body: {
  checkin: string;
  checkout: string;
  roomId?: string;
  channel?: string;
  guestName?: string;
}): Promise<{ id: string; status: string; reference?: string; error?: string }> {
  return apiFetch('/ota/simulate', { method: 'POST', body: JSON.stringify(body) });
}

// --- Compartment I: restrictions, ARI history, reviews, customers -------------

export function setRestrictions(
  roomId: string,
  body: { from: string; to: string; minStay: number; maxStay: number },
): Promise<{ updated: number; from: string; to: string; minStay: number; maxStay: number }> {
  return apiFetch(`/rooms/${roomId}/restrictions`, { method: 'POST', body: JSON.stringify(body) });
}

export interface AriHistoryEntry {
  id: string;
  roomId: string;
  kind: 'availability' | 'price' | 'drop' | 'restriction';
  fromDate: string;
  toDate: string;
  detail: Record<string, unknown>;
  actorEmail: string | null;
  createdAt: string;
}
export function getAriHistory(roomId: string): Promise<AriHistoryEntry[]> {
  return apiFetch<AriHistoryEntry[]>(`/rooms/${roomId}/ari-history`);
}

export interface Review {
  id: string;
  propertyId: string;
  propertyName: string;
  bookingReference: string;
  rating: number;
  comment: string | null;
  guestName: string;
  createdAt: string;
}
export interface ReviewSummary {
  propertyId: string;
  propertyName: string;
  count: number;
  average: number;
}
export function listReviews(): Promise<{ reviews: Review[]; summary: ReviewSummary[] }> {
  return apiFetch('/reviews');
}

export interface ReviewInviteInfo {
  guestName: string;
  propertyName: string;
  checkin: string;
  checkout: string;
  used: boolean;
}
export function getReviewInvite(token: string): Promise<ReviewInviteInfo> {
  return apiFetch<ReviewInviteInfo>(`/reviews/invite/${token}`);
}
export function submitReview(body: {
  token: string;
  rating: number;
  comment?: string;
}): Promise<{ submitted: boolean; propertyName: string }> {
  return apiFetch('/reviews', { method: 'POST', body: JSON.stringify(body) });
}

export interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  country: string | null;
  vip: boolean;
  firstSeen: string;
  bookings: number;
  nights: number;
  totalSpend: string;
  /** Denomination of `totalSpend` — this guest's own bookings, not the tenant's. */
  currency?: CurrencyCode;
  /** True when this guest stayed at properties with different base currencies. */
  approximate?: boolean;
  lastCheckin: string | null;
}
export function listCustomers(): Promise<CustomerRow[]> {
  return apiFetch<CustomerRow[]>('/customers');
}
export function getCustomer(id: string): Promise<CustomerRow & { history: Booking[] }> {
  return apiFetch(`/customers/${id}`);
}
