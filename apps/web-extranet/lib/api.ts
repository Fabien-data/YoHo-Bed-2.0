const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const TOKEN_KEY = 'yoho_token';
const USER_KEY = 'yoho_user';

export interface Membership {
  tenantId: string | null;
  role: string;
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
    const message =
      (data && (data.message || data.reason)) || res.statusText || 'Request failed';
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

export function getAvailability(roomId: string, from: string, to: string): Promise<AvailabilityDay[]> {
  return apiFetch<AvailabilityDay[]>(
    `/rooms/${roomId}/availability?from=${from}&to=${to}`,
  );
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

export interface Booking {
  id: string;
  reference: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled' | 'NoShow';
  source: string;
  checkin: string;
  checkout: string;
  nights: number;
  rooms: number;
  amount: string;
  roomId: string;
  customerName: string;
}

export function listBookings(): Promise<Booking[]> {
  return apiFetch<Booking[]>('/bookings');
}

export function createBooking(body: {
  roomId: string;
  occupancyId: string;
  customerName: string;
  checkin: string;
  checkout: string;
  rooms?: number;
  couponCode?: string;
  referralCode?: string;
}): Promise<{ id: string; reference: string; amount: string }> {
  return apiFetch('/bookings', { method: 'POST', body: JSON.stringify(body) });
}

export function bookingTransition(
  id: string,
  action: 'approve' | 'reject' | 'cancel' | 'no-show',
): Promise<Booking> {
  return apiFetch(`/bookings/${id}/${action}`, {
    method: 'POST',
    body: action === 'reject' ? JSON.stringify({}) : undefined,
  });
}

export interface PayoutStatement {
  propertyId: string;
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
}

export function getRevenue(from: string, to: string): Promise<Revenue> {
  return apiFetch<Revenue>(`/finance/revenue?from=${from}&to=${to}`);
}

// --- Staff console ----------------------------------------------------------

export function isStaff(user: SessionUser | null): boolean {
  return !!user?.memberships.some((m) => m.role === 'YOHO_STAFF' || m.role === 'YOHO_ADMIN');
}

export interface StaffTenant {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'inactive' | 'suspended';
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
  return apiFetch(`/properties/${propertyId}/promotions`, { method: 'POST', body: JSON.stringify(body) });
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
