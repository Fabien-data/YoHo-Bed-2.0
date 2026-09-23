import type { CurrencyCode } from '@yohobed/domain';
import type {
  SmartPropertyDocument,
  SmartIssue,
  SmartNightQuote,
  SmartGuestMix,
} from '@yohobed/domain';

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

/** Registration numbers a property prints on its documents (sparse). */
export interface PropertyTaxIds {
  tin?: string;
  ssclRegNo?: string;
  sltdaRegNo?: string;
  gstin?: string;
  sstNo?: string;
  ttxNo?: string;
  brn?: string;
}

export interface Property {
  id: string;
  name: string;
  /** Base currency the property prices/settles in. */
  currency?: CurrencyCode;
  code?: string | null;
  propertyType?: string | null;
  legalName?: string | null;
  address?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  reservationPhone?: string | null;
  email?: string | null;
  website?: string | null;
  fax?: string | null;
  registrationNumber?: string | null;
  additionalRegistrationNumbers?: string[];
  latitude?: number | null;
  longitude?: number | null;
  logoMediaId?: string | null;
  /** ISO 3166-1 alpha-2; selects the regional preset. */
  countryCode?: string;
  /** ISO subdivision (LK/MY) or GST state code (IN). */
  stateCode?: string | null;
  timezone?: string;
  /** 'HH:MM:SS' */
  checkinTime?: string;
  checkoutTime?: string;
  starRating?: number | null;
  taxIds?: PropertyTaxIds;
  branchCode?: string | null;
  fyStartMonth?: number;
  invoicePrefix?: string | null;
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
    /** The server's `X-Request-Id` — the reference staff read out to support. */
    public requestId?: string,
  ) {
    super(message);
  }
}

/** The last failed request's reference, for the error screen and "Contact support". */
let lastErrorRef: string | null = null;
export function getLastErrorRef(): string | null {
  return lastErrorRef;
}

/**
 * What to tell the user (UX-STANDARD §5): the server's own sentence for a problem they can fix,
 * and for a fault on our side a plain apology plus the reference support needs.
 */
export function describeError(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof ApiError) {
    if (e.status >= 500 || e.status === 0) {
      return e.requestId ? `${fallback}. Reference ${e.requestId}.` : `${fallback}.`;
    }
    return e.message;
  }
  return e instanceof Error && e.message ? e.message : fallback;
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function getUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    // A corrupt stored user must not white-screen the app forever — end the session and re-login.
    clearSession();
    return null;
  }
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
    endSessionIfTokenRejected(res.status, token);
    const message = (data && (data.message || data.reason)) || res.statusText || 'Request failed';
    const requestId = res.headers.get('X-Request-Id') ?? undefined;
    if (requestId) lastErrorRef = requestId;
    throw new ApiError(
      res.status,
      Array.isArray(message) ? message.join(', ') : message,
      data,
      requestId,
    );
  }
  return data as T;
}

/** The one place the "server said our token is dead" rule lives — see the comment above. */
function endSessionIfTokenRejected(status: number, token: string | null): void {
  if (status === 401 && token && typeof window !== 'undefined') {
    clearSession();
    window.location.replace('/?expired=1');
  }
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

export type OperationalRole = 'OWNER_STAFF' | 'HOUSEKEEPING_ATTENDANT' | 'HOUSEKEEPING_SUPERVISOR';
export interface TeamMember {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'invited' | 'disabled';
  role: 'OWNER' | OperationalRole;
  createdAt: string;
}
export function listTeamMembers(): Promise<TeamMember[]> {
  return apiFetch('/auth/staff');
}
export function inviteTeamMember(body: {
  name: string;
  email: string;
  role: OperationalRole;
}): Promise<TeamMember> {
  return apiFetch('/auth/staff', { method: 'POST', body: JSON.stringify(body) });
}
export function updateTeamMember(
  id: string,
  body: { role?: OperationalRole; status?: 'active' | 'disabled' },
): Promise<TeamMember> {
  return apiFetch(`/auth/staff/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export type HotelPermission =
  | 'reservation_read'
  | 'reservation_change'
  | 'check_in_out'
  | 'room_assignment'
  | 'financial_read'
  | 'price_change'
  | 'minimum_exception'
  | 'housekeeping'
  | 'setup';
export interface HotelAccess {
  role: string;
  permissions: HotelPermission[] | null;
  propertyIds: string[] | null;
}
export interface HotelRole {
  id: string;
  name: string;
  permissions: HotelPermission[];
  propertyIds: string[];
  members: Array<{ membershipId: string; userId: string; name: string; email: string }>;
}
export interface HotelRoleTemplate {
  name: string;
  permissions: HotelPermission[];
}
export interface HotelRoleInput {
  name: string;
  permissions: HotelPermission[];
  propertyIds: string[];
}
export function getHotelAccess(): Promise<HotelAccess> {
  return apiFetch('/hotel-access');
}
export function publishSmartSetup(
  propertyId: string,
  expectedVersion: number,
): Promise<{
  policy: SmartSetupConfiguration['policy'];
  channelPublishing: { supported: boolean; reason: string };
}> {
  return apiFetch(`/properties/${propertyId}/smart-setup/publish`, {
    method: 'POST',
    body: JSON.stringify({ expectedVersion, acknowledgeChannelLimit: true }),
  });
}
export function getBookingStay(
  id: string,
): Promise<{ id: string; checkin: string; checkout: string }> {
  return apiFetch(`/bookings/${id}`);
}
export function listHotelRoles(): Promise<HotelRole[]> {
  return apiFetch('/hotel-roles');
}
export function listHotelRoleTemplates(): Promise<HotelRoleTemplate[]> {
  return apiFetch('/hotel-roles/templates');
}
export function createHotelRole(body: HotelRoleInput): Promise<HotelRole> {
  return apiFetch('/hotel-roles', { method: 'POST', body: JSON.stringify(body) });
}
export function updateHotelRole(id: string, body: HotelRoleInput): Promise<HotelRole> {
  return apiFetch(`/hotel-roles/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export function assignHotelRole(id: string, userId: string): Promise<unknown> {
  return apiFetch(`/hotel-roles/${id}/assign`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}
export function revokeHotelRole(id: string, userId: string): Promise<unknown> {
  return apiFetch(`/hotel-roles/${id}/assign/${userId}`, { method: 'DELETE' });
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
    // Uploads must end a dead session exactly like every other call — this was the one path that
    // left the user "signed in" showing a raw token error.
    endSessionIfTokenRejected(res.status, token);
    throw new ApiError(res.status, (data && data.message) || res.statusText, data);
  }
  return data as T;
}

// --- Private files: payment slips and ID scans (Phase 02, Sprint 5) ------------------------

export type PrivateFilePurpose = 'payment_slip' | 'id_document' | 'other';

export interface PrivateFile {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  purpose: PrivateFilePurpose;
  createdAt: string;
}

/** A photo (JPEG, PNG, WebP) or a PDF, at most 8 MB. Attach it to a payment or document by id. */
export function uploadPrivateFile(purpose: PrivateFilePurpose, file: File): Promise<PrivateFile> {
  return apiUpload(`/files?purpose=${purpose}`, file);
}

/** Drop a file that was uploaded but never attached. An attached one is kept (409). */
export function deletePrivateFile(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiFetch(`/files/${id}`, { method: 'DELETE' });
}

/**
 * Show a private file in a new tab. It needs the session, so it is fetched with the token rather
 * than linked — a plain URL would not open, and must not. The tab is opened before the fetch so a
 * popup blocker still sees the click.
 */
export async function openPrivateFile(id: string): Promise<void> {
  const tab = window.open('about:blank', '_blank');
  const token = getToken();
  const res = await fetch(`${API_BASE}/files/${id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    tab?.close();
    endSessionIfTokenRejected(res.status, token);
    throw new ApiError(res.status, res.status === 404 ? 'File not found' : res.statusText, null);
  }
  const url = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = url;
  else window.location.assign(url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

export function voidBooking(id: string): Promise<Booking> {
  return apiFetch(`/bookings/${id}/void`, { method: 'POST' });
}

// --- The guided front desk (UX-1a/1b) ------------------------------------------------------

/** A refusal from a front-desk action: machine reason + a sentence that says what to do. */
export interface DeskProblem {
  reason: string;
  message: string;
  rooms?: string[];
  balance?: string;
  currency?: string;
  checkin?: string;
  /** `registration_required`: what Malaysia's guest register still lacks (Sprint 7). */
  missing?: string[];
}

export interface CheckInPreview {
  ok: boolean;
  problem: DeskProblem | null;
  /** The room(s) the guest walks into tonight, and whether each is clean. */
  rooms: Array<{ code: string; housekeeping: string }>;
  balance: string;
  currency: string;
  requireDocuments: boolean;
  customerId: string;
}

export interface CheckOutPreview {
  ok: boolean;
  problem: DeskProblem | null;
  /** What the guest still owes after any company bill moves to the city ledger. */
  balance: string;
  currency: string;
  policy: 'block' | 'allow';
  unstayedNights: number;
  /** The hotel's operating date. */
  today: string;
  guestEmail: string | null;
}

/** What the guest still owes on a stay: the Reservations list's Total − Paid. */
export function getBookingBalance(id: string): Promise<{ balance: string; currency: string }> {
  return apiFetch(`/bookings/${id}/balance`);
}

export function getCheckInPreview(id: string): Promise<CheckInPreview> {
  return apiFetch(`/bookings/${id}/check-in-preview`);
}

export function getCheckOutPreview(id: string): Promise<CheckOutPreview> {
  return apiFetch(`/bookings/${id}/check-out-preview`);
}

export function checkInBooking(
  id: string,
  body: { reason?: string; overrideDirty?: boolean } = {},
): Promise<Booking> {
  return apiFetch(`/bookings/${id}/check-in`, { method: 'POST', body: JSON.stringify(body) });
}

export function checkOutBooking(
  id: string,
  body: { reason?: string; allowBalance?: boolean; approvalToken?: string } = {},
): Promise<Booking> {
  return apiFetch(`/bookings/${id}/check-out`, { method: 'POST', body: JSON.stringify(body) });
}

export function switchToCleanRooms(
  id: string,
): Promise<Array<{ code: string; housekeeping: string }>> {
  return apiFetch(`/bookings/${id}/rooms/switch-clean`, { method: 'POST' });
}

export function cancelBooking(id: string, reason: string): Promise<Booking> {
  return apiFetch(`/bookings/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export function undoCheckIn(id: string, reason: string): Promise<Booking> {
  return apiFetch(`/bookings/${id}/undo-check-in`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function undoCheckOut(id: string, reason: string): Promise<Booking> {
  return apiFetch(`/bookings/${id}/undo-check-out`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function reinstateBooking(id: string, reason: string): Promise<Booking> {
  return apiFetch(`/bookings/${id}/reinstate`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function changeDeparture(id: string, checkout: string, reason: string): Promise<Booking> {
  return apiFetch(`/bookings/${id}/change-departure`, {
    method: 'POST',
    body: JSON.stringify({ checkout, reason }),
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

export interface StayChangeReview {
  bookingId: string;
  expectedUpdatedAt: string;
  old: { checkin: string; checkout: string; amount: string };
  proposed: { checkin: string; checkout: string; amount: string; difference: string };
  nights: Array<{ date: string; amount: string; retained: boolean }>;
  conflicts: string[];
}
export function previewStayChange(
  bookingId: string,
  checkin: string,
  checkout: string,
): Promise<StayChangeReview> {
  return apiFetch(`/bookings/${bookingId}/stay-change/preview`, {
    method: 'POST',
    body: JSON.stringify({ checkin, checkout }),
  });
}
export function commitStayChange(review: StayChangeReview): Promise<Booking> {
  return apiFetch(`/bookings/${review.bookingId}/stay-change`, {
    method: 'POST',
    body: JSON.stringify({
      checkin: review.proposed.checkin,
      checkout: review.proposed.checkout,
      expectedUpdatedAt: review.expectedUpdatedAt,
      expectedAmount: review.proposed.amount,
    }),
  });
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

/** Staff only: set a rate by hand when the provider has none or is wrong (audited). Sprint 7. */
export function overrideFxRate(body: { base: string; rate: number; note?: string }) {
  return apiFetch<{ base: string; rate: number; quote: string; source: string }>('/fx/override', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// --- Stay view (the tape chart) ---------------------------------------------

export interface StayBar {
  hasNotes?: boolean;
  amount?: string;
  balance?: string;
  roomId?: string;
  adults?: number;
  children?: number;
  vip?: boolean;
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
  /** Yanolja's reservation type (Development Phase 02). */
  reservationKind?: string;
  /** When a hold gives its rooms back. */
  holdUntil?: string | null;
  /** The business source's short code and palette colour. */
  sourceCode?: string | null;
  sourceColor?: string | null;
  /** On a tentative bar: the room the guest asked for. */
  preferredRoomUnitId?: string | null;
}

export interface StayUnit {
  notes?: string | null;
  housekeepingNotes?: string | null;
  smokingPolicy?: string;
  wheelchairAccessible?: boolean;
  id: string;
  roomId: string;
  code: string;
  displayName: string | null;
  housekeeping: 'dirty' | 'clean' | 'inspected' | 'out_of_order';
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
  property: { id: string; name: string; code: string | null; currency: string; timezone?: string };
  from: string;
  to: string;
  dates: string[];
  roomTypes: StayRoomType[];
  unassigned: Array<StayBar & { roomId: string }>;
  /** Bookings that hold no rooms yet (inquiries) — their own lane, never counted as sold. */
  tentative?: Array<StayBar & { roomId: string }>;
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

export function getStayView(
  propertyId: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<StayView> {
  return apiFetch<StayView>(`/stayview?propertyId=${propertyId}&from=${from}&to=${to}`, { signal });
}

export interface BookingLeg {
  id: string;
  legIndex: number;
  roomUnitId: string | null;
  code: string | null;
  displayName: string | null;
  checkin: string;
  checkout: string;
  adults: number;
  children: number;
  updatedAt: string;
  releasedAt: string | null;
}

export function getBookingLegs(bookingId: string): Promise<BookingLeg[]> {
  return apiFetch<BookingLeg[]>(`/bookings/${bookingId}/rooms`);
}

export function assignRooms(
  bookingId: string,
  assignments: Array<{ legId: string; roomUnitId: string | null; expectedUpdatedAt?: string }>,
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

export interface RoomMove {
  id: string;
  bookingId: string;
  legId: string;
  fromRoomUnitId: string;
  toRoomUnitId: string;
  effectiveDate: string;
  status: 'planned' | 'completed' | 'stopped';
  createdAt: string;
}

export function listRoomMoves(bookingId: string): Promise<RoomMove[]> {
  return apiFetch(`/bookings/${bookingId}/room-moves`);
}

export function moveRoom(
  bookingId: string,
  body: { legId: string; toRoomUnitId: string; effectiveDate?: string; expectedUpdatedAt?: string },
): Promise<RoomMove> {
  return apiFetch(`/bookings/${bookingId}/room-move`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function exchangeRooms(legId: string, otherLegId: string): Promise<RoomMove[]> {
  return apiFetch('/room-moves/exchange', {
    method: 'POST',
    body: JSON.stringify({ legId, otherLegId }),
  });
}

export function stopRoomMove(id: string): Promise<RoomMove> {
  return apiFetch(`/room-moves/${id}/stop`, { method: 'POST' });
}

export interface RoomUnit {
  id: string;
  propertyId: string;
  roomId: string;
  roomName: string;
  code: string;
  displayName: string | null;
  displayOrder: number;
  floor: string | null;
  notes: string | null;
  smokingPolicy: 'unspecified' | 'smoking' | 'non_smoking';
  wheelchairAccessible: boolean;
  connectedRoomUnitId: string | null;
  mapX: number | null;
  mapY: number | null;
  status: 'active' | 'inactive';
}

export function listRoomUnits(propertyId: string): Promise<RoomUnit[]> {
  return apiFetch<RoomUnit[]>(`/properties/${propertyId}/room-units`);
}

export interface SmartSetupConfiguration {
  property: { id: string; name: string; currency: string };
  categories: Array<{ id: string; name: string; quantity: number }>;
  rates: Array<{
    id: string;
    label: string;
    roomId: string;
    code: string;
    audience: string;
    status: string;
  }>;
  policy: {
    draft: SmartPropertyDocument;
    draftVersion: number;
    published: SmartPropertyDocument | null;
    publishedVersion: number | null;
  } | null;
  issues: SmartIssue[];
}
export function getSmartSetup(propertyId: string): Promise<SmartSetupConfiguration> {
  return apiFetch(`/properties/${propertyId}/smart-setup`);
}
export function saveSmartDraft(
  propertyId: string,
  expectedVersion: number,
  document: SmartPropertyDocument,
): Promise<{ policy: SmartSetupConfiguration['policy']; issues: SmartIssue[] }> {
  return apiFetch(`/properties/${propertyId}/smart-setup/draft`, {
    method: 'PUT',
    body: JSON.stringify({ expectedVersion, document }),
  });
}
export function previewSmartBooking(
  propertyId: string,
  expectedVersion: number,
  body: { occupancyId: string; checkin: string; checkout: string; guests: SmartGuestMix },
): Promise<{
  eligible: boolean;
  issues: SmartIssue[];
  nights: Array<{
    date: string;
    quote: SmartNightQuote | null;
    economics: {
      hotelBaseNetMinor: number;
      commissionMinor: number;
      channelMarginMinor: number;
      taxesMinor: number;
      guestTotalMinor: number;
    } | null;
  }>;
  currency: string;
  policyVersion: number;
  totalNetMinor: number;
  guestTotalMinor: number;
}> {
  return apiFetch(`/properties/${propertyId}/smart-setup/preview`, {
    method: 'POST',
    body: JSON.stringify({ ...body, expectedVersion }),
  });
}
export type BulkRoomInput = {
  roomId: string;
  code: string;
  displayName?: string | null;
  floor?: string;
  notes?: string;
  wheelchairAccessible?: boolean;
};
export function previewBulkRooms(
  propertyId: string,
  units: BulkRoomInput[],
): Promise<{
  valid: boolean;
  count: number;
  issues: Array<{ index: number; field: string; message: string }>;
}> {
  return apiFetch(`/properties/${propertyId}/room-units/bulk-preview`, {
    method: 'POST',
    body: JSON.stringify({ units }),
  });
}
export function createBulkRooms(propertyId: string, units: BulkRoomInput[]): Promise<RoomUnit[]> {
  return apiFetch(`/properties/${propertyId}/room-units/bulk`, {
    method: 'POST',
    body: JSON.stringify({ units }),
  });
}

export function createRoomUnit(
  propertyId: string,
  body: {
    roomId: string;
    code: string;
    displayName?: string | null;
    floor?: string;
    smokingPolicy?: RoomUnit['smokingPolicy'];
    wheelchairAccessible?: boolean;
    connectedRoomUnitId?: string | null;
  },
): Promise<RoomUnit> {
  return apiFetch(`/properties/${propertyId}/room-units`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateRoomUnit(
  id: string,
  body: Partial<
    Pick<
      RoomUnit,
      | 'code'
      | 'displayName'
      | 'floor'
      | 'notes'
      | 'smokingPolicy'
      | 'wheelchairAccessible'
      | 'connectedRoomUnitId'
      | 'status'
    >
  >,
): Promise<RoomUnit> {
  return apiFetch(`/room-units/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
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
  displayName: string | null;
  roomId: string;
  roomName: string;
  floor: string | null;
  mapX: number | null;
  mapY: number | null;
  smokingPolicy: 'unspecified' | 'smoking' | 'non_smoking';
  wheelchairAccessible: boolean;
  connectedRoomUnitId: string | null;
  unitStatus: 'active' | 'inactive';
  state: RoomState;
  frontDeskLabel: string;
  housekeeping: HousekeepingState;
  remarks: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  guestName: string | null;
  guestEmail: string | null;
  bookingId: string | null;
  legId: string | null;
  bookingStatus: BookingStatus | null;
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
  doNotDisturb: boolean;
  requestedSafetyFlag: boolean;
  groupBooking: boolean;
  groupOwner: boolean;
  splitReservation: boolean;
  plannedMove: boolean;
  dayUse: boolean;
  mealPlan: string | null;
  nextReservation: { guestName: string; checkin: string } | null;
  cleaningTask: { id: string; status: string; rush: boolean; kind: string } | null;
}

export interface FloorLayout {
  id: string;
  floor: string;
  version: number;
  landmarks: Array<{
    id: string;
    kind: 'corridor' | 'lift' | 'stairs' | 'service';
    x: number;
    y: number;
    label?: string;
  }>;
}
export function listFloorLayouts(propertyId: string): Promise<FloorLayout[]> {
  return apiFetch(`/properties/${propertyId}/floor-layouts`);
}
export function saveFloorLayout(
  propertyId: string,
  body: {
    floor: string;
    expectedVersion: number | null;
    rooms: Array<{ unitId: string; x: number; y: number }>;
    landmarks: FloorLayout['landmarks'];
  },
): Promise<FloorLayout> {
  return apiFetch(`/properties/${propertyId}/floor-layouts`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
export interface CleaningTask {
  id: string;
  roomUnitId: string;
  code: string;
  displayName: string | null;
  floor: string | null;
  date: string;
  roomReadiness: HousekeepingState | null;
  kind: string;
  status: string;
  rush: boolean;
  assignedToUserId: string | null;
  assignedToName: string | null;
  notes: string | null;
  guestName: string | null;
}
export function listCleaningTasks(propertyId: string, date: string): Promise<CleaningTask[]> {
  return apiFetch(`/properties/${propertyId}/housekeeping/tasks?date=${date}`);
}
export function updateCleaningTask(
  id: string,
  body: {
    status?: string;
    rush?: boolean;
    assignedToUserId?: string | null;
    notes?: string | null;
  },
): Promise<CleaningTask> {
  return apiFetch(`/housekeeping/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export function setRoomSignals(
  bookingId: string,
  body: { doNotDisturb?: boolean; requestedSafetyFlag?: boolean },
): Promise<unknown> {
  return apiFetch(`/bookings/${bookingId}/room-signals`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
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

/**
 * Authenticated SSE over fetch (native EventSource cannot attach the bearer token). It reconnects
 * until the caller aborts; Room View also polls, so a proxy that buffers streams cannot stale it.
 */
export function subscribeRoomUpdates(
  propertyId: string,
  date: string,
  onUpdate: () => void,
): AbortController {
  const controller = new AbortController();
  const connect = async () => {
    while (!controller.signal.aborted) {
      try {
        const token = getToken();
        const res = await fetch(
          `${API_BASE}/room-updates?propertyId=${encodeURIComponent(propertyId)}&date=${encodeURIComponent(date)}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: controller.signal,
          },
        );
        if (!res.ok || !res.body) throw new Error(`Room update stream returned ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          // Only a real change refreshes; `ping` keep-alives just hold the connection open.
          if (events.some((event) => event.split('\n').includes('event: room-update'))) onUpdate();
        }
      } catch {
        if (controller.signal.aborted) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  };
  void connect();
  return controller;
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

export type ReservationTab =
  'all' | 'upcoming' | 'booked' | 'arrivals' | 'departures' | 'inhouse' | 'cancelled';

/** The Type filter: one reservation kind, or both hold kinds together. */
export type ReservationKindFilter = ReservationKind | 'holds';

export interface ReservationRow {
  id: string;
  reference: string;
  status: string;
  reservationKind: ReservationKind;
  inventoryHeld: boolean;
  holdUntil: string | null;
  origin: BookingOrigin;
  voucherNo: string | null;
  siblingIndex: number | null;
  businessSourceId: string | null;
  sourceName: string | null;
  sourceCode: string | null;
  sourceColor: string | null;
  marketSegmentId: string | null;
  segmentName: string | null;
  segmentCode: string | null;
  source: string;
  channel: string | null;
  checkin: string;
  checkout: string;
  /** 'HH:MM:SS', or null for the property's standard time. */
  arrivalTime: string | null;
  departureTime: string | null;
  nights: number;
  rooms: number;
  roomId: string;
  roomTypeName: string | null;
  rateCode: string | null;
  amount: string;
  discount: string;
  currency: string;
  groupId: string | null;
  groupCode: string | null;
  groupName: string | null;
  customerId: string;
  guestName: string;
  guestTitle: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  vip: boolean;
  createdAt: string;
  createdByUserId: string | null;
  createdByName: string | null;
  /** Received less refunded. */
  paid: string;
  /** Charges on the bill other than the room. */
  extras: string;
  adults: number;
  children: number;
  /** People sharing the room besides the guest it is booked for. */
  extraGuests: number;
  remarks: number;
  roomCodes: string[];
  /** Room (after any coupon) plus extras. */
  total: string;
  balance: string;
  balanceDue: boolean;
}

export interface ReservationList {
  date: string;
  tab: ReservationTab;
  counts: Record<ReservationTab, number>;
  total: number;
  limit: number;
  offset: number;
  rows: ReservationRow[];
}

export interface ReservationFilters {
  propertyId: string;
  date: string;
  tab?: ReservationTab;
  q?: string;
  kind?: ReservationKindFilter;
  origin?: BookingOrigin;
  businessSourceId?: string;
  marketSegmentId?: string;
  ledgerAccountId?: string;
  createdBy?: string;
  /** One group's rooms, whatever the tab. */
  groupId?: string;
  groupsOnly?: boolean;
}

function reservationParams(params: ReservationFilters): URLSearchParams {
  const sp = new URLSearchParams({ propertyId: params.propertyId, date: params.date });
  for (const k of [
    'tab',
    'q',
    'kind',
    'origin',
    'businessSourceId',
    'marketSegmentId',
    'ledgerAccountId',
    'createdBy',
    'groupId',
  ] as const) {
    const v = params[k];
    if (v) sp.set(k, v);
  }
  if (params.groupsOnly) sp.set('groupsOnly', 'true');
  return sp;
}

export function getReservations(
  params: ReservationFilters & { limit?: number; offset?: number },
): Promise<ReservationList> {
  const sp = reservationParams(params);
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.offset) sp.set('offset', String(params.offset));
  return apiFetch<ReservationList>(`/reservations?${sp.toString()}`);
}

/**
 * Every row of a tab as CSV, fetched with the session's token and handed to the browser as a
 * download. A plain link would not carry the Authorization header.
 */
export async function downloadReservationsCsv(params: ReservationFilters): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/reservations/export?${reservationParams(params)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    endSessionIfTokenRejected(res.status, token);
    throw new ApiError(res.status, 'The export failed. Try again.');
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `reservations-${params.tab ?? 'all'}-${params.date}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type GroupTab = 'upcoming' | 'inhouse' | 'departed';

/** One card of Yanolja's group view. */
export interface ReservationGroupCard {
  id: string;
  code: string;
  name: string | null;
  kind: string;
  billTo: string | null;
  ownerName: string | null;
  checkin: string;
  checkout: string;
  nights: number;
  bookedAt: string;
  /** Every room, and the rooms still live ("2 (3)"). */
  roomsTotal: number;
  roomsLive: number;
  inHouse: number;
  departed: number;
  toCome: number;
  roomNights: number;
  roomTotal: string;
  currency: string;
  voucherNo: string | null;
  hasHold: boolean;
  extras: string;
  paid: string;
  adults: number;
  children: number;
  sourceCode: string | null;
  sourceColor: string | null;
  sourceName: string | null;
  total: string;
  balance: string;
  /** Per room per night. */
  averageRate: string;
}

export interface ReservationGroupList {
  date: string;
  tab: GroupTab;
  total: number;
  limit: number;
  offset: number;
  rows: ReservationGroupCard[];
}

export function getReservationGroups(params: {
  propertyId: string;
  date: string;
  tab: GroupTab;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<ReservationGroupList> {
  const sp = new URLSearchParams({
    propertyId: params.propertyId,
    date: params.date,
    tab: params.tab,
  });
  if (params.q) sp.set('q', params.q);
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.offset) sp.set('offset', String(params.offset));
  return apiFetch(`/reservation-groups?${sp}`);
}

/** Merge whole groups into `targetGroupId`, whose owner stays the owner. */
export function mergeReservationGroups(
  targetGroupId: string,
  groupIds: string[],
): Promise<BookingGroup> {
  return apiFetch('/reservation-groups/merge', {
    method: 'POST',
    body: JSON.stringify({ targetGroupId, groupIds }),
  });
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
  /** Null when the reservation asked for the card to be printed without its rate. */
  amount: string | null;
  taxes: string | null;
  rateSuppressed: boolean;
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
  /** What the stay includes; the price is null when the rate is suppressed. */
  inclusions: Array<{
    name: string;
    rhythm: InclusionRhythm;
    unitPrice: string | null;
    includedInRate: boolean;
    itemize: boolean;
  }>;
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
  // Regional profile (Development Phase 02) — the register fields Malaysia's Act asks for.
  nationalityCode?: string | null;
  gender?: 'male' | 'female' | 'other' | null;
  occupation?: string | null;
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
  source: 'room' | 'manual' | 'pos' | 'inclusion' | 'levy';
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
  /** A levy line's code (Malaysia's TTX), Sprint 7. */
  levyCode?: string | null;
  particularCode: string | null;
}

export interface FolioPaymentRow {
  id: string;
  /** `sent` is money given back to the guest — a refund (UX-1b). */
  direction: 'received' | 'sent';
  /** A refund's reason ("Refund: …"). */
  note: string | null;
  amount: string;
  method: string;
  /** The hotel's own method ("LankaQR"), when one was used. */
  methodName: string | null;
  reference: string | null;
  receiptNo: string | null;
  /** A slip photo, served by openPrivateFile. */
  attachmentFileId: string | null;
  /** Set when the amount was moved to a travel agent's or company's account. */
  ledgerAccountId: string | null;
  createdAt: string;
}

export type FolioPayerType = 'guest' | 'company' | 'travel_agent';

export interface FolioWindow {
  id: string;
  window: number;
  label: string;
  status: 'open' | 'closed' | 'void';
  currency: string;
  /** Who this window bills. */
  payerType: FolioPayerType;
  payerName: string | null;
  payerLedgerAccountId: string | null;
  /** Charge sources this window takes instead of window 1 ("extras to the guest"). */
  routes: string[];
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

export function voidFolioCharge(chargeId: string, reason: string): Promise<FolioLine> {
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
  body: {
    amount: number;
    method?: string;
    /** One of the property's payment methods; decides the category, reference rule and drawer. */
    paymentMethodId?: string;
    reference?: string;
    fileId?: string;
    drawerSessionId?: string;
    /** The desk confirmed this is a second payment, not the first one entered twice. */
    confirmDuplicate?: boolean;
  },
): Promise<FolioPaymentRow> {
  return apiFetch(`/folios/${folioId}/payments`, { method: 'POST', body: JSON.stringify(body) });
}

/** Money back to the guest (UX-1b). Anyone but the owner sends the owner's `approvalToken`. */
export function refundFolio(
  folioId: string,
  body: {
    amount: number;
    paymentMethodId: string;
    reason: string;
    reference?: string;
    approvalToken?: string;
  },
): Promise<FolioPaymentRow> {
  return apiFetch(`/folios/${folioId}/refunds`, { method: 'POST', body: JSON.stringify(body) });
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

export function updateChargeParticular(
  id: string,
  body: Partial<{
    name: string;
    category: string;
    defaultPrice: number;
    taxRatePct: number;
    taxInclusive: boolean;
    active: boolean;
  }>,
): Promise<ChargeParticular> {
  return apiFetch(`/charge-particulars/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
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

// --- Reservation configuration (Development Phase 02) --------------------------

export type SourceCategory = 'direct' | 'ota' | 'travel_agent' | 'corporate';
export type CommissionPlan =
  'none' | 'pct_all_nights' | 'pct_first_night' | 'fixed_per_night' | 'fixed_per_stay';
export type MarketSegmentGroup = 'transient' | 'group' | 'contract' | 'non_revenue';
export type PaymentCategory =
  | 'cash'
  | 'card'
  | 'bank_transfer'
  | 'qr'
  | 'wallet'
  | 'cheque'
  | 'city_ledger'
  | 'online'
  | 'other';

export interface BusinessSource {
  id: string;
  shortCode: string;
  name: string;
  /** Legacy hex colour; the UI uses `palette`. */
  color: string;
  active: boolean;
  category: SourceCategory;
  registrationNo: string | null;
  defaultMarketSegmentId: string | null;
  commissionPlan: CommissionPlan;
  commissionValue: string;
  palette: string;
  collectsTourismTax: boolean;
  sort: number;
}

export interface BusinessSourceInput {
  shortCode?: string;
  name?: string;
  category?: SourceCategory;
  palette?: string;
  registrationNo?: string | null;
  defaultMarketSegmentId?: string | null;
  commissionPlan?: CommissionPlan;
  commissionValue?: number;
  collectsTourismTax?: boolean;
  sort?: number;
  active?: boolean;
}

export function listBusinessSources(): Promise<BusinessSource[]> {
  return apiFetch<BusinessSource[]>('/business-sources');
}

export function createBusinessSource(
  body: BusinessSourceInput & { shortCode: string; name: string },
): Promise<BusinessSource> {
  return apiFetch('/business-sources', { method: 'POST', body: JSON.stringify(body) });
}

export function updateBusinessSource(
  id: string,
  body: Omit<BusinessSourceInput, 'shortCode'>,
): Promise<BusinessSource> {
  return apiFetch(`/business-sources/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export interface MarketSegment {
  id: string;
  code: string;
  name: string;
  grp: MarketSegmentGroup;
  palette: string;
  excludedFromSold: boolean;
  sort: number;
  active: boolean;
}

export interface MarketSegmentInput {
  code?: string;
  name?: string;
  group?: MarketSegmentGroup;
  palette?: string;
  excludedFromSold?: boolean;
  sort?: number;
  active?: boolean;
}

export function listMarketSegments(): Promise<MarketSegment[]> {
  return apiFetch('/market-segments');
}

export function createMarketSegment(
  body: MarketSegmentInput & { code: string; name: string },
): Promise<MarketSegment> {
  return apiFetch('/market-segments', { method: 'POST', body: JSON.stringify(body) });
}

export function updateMarketSegment(
  id: string,
  body: Omit<MarketSegmentInput, 'code'>,
): Promise<MarketSegment> {
  return apiFetch(`/market-segments/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export interface PaymentMethod {
  id: string;
  propertyId: string | null;
  code: string;
  name: string;
  shortName: string;
  category: PaymentCategory;
  requiresReference: boolean;
  isDefaultCash: boolean;
  isGuestAdvance: boolean;
  currency: string | null;
  sort: number;
  active: boolean;
}

export interface PaymentMethodInput {
  code?: string;
  name?: string;
  shortName?: string;
  category?: PaymentCategory;
  propertyId?: string | null;
  requiresReference?: boolean;
  isDefaultCash?: boolean;
  isGuestAdvance?: boolean;
  currency?: string | null;
  sort?: number;
  active?: boolean;
}

export function listPaymentMethods(): Promise<PaymentMethod[]> {
  return apiFetch('/payment-methods');
}

export function createPaymentMethod(
  body: PaymentMethodInput & {
    code: string;
    name: string;
    shortName: string;
    category: PaymentCategory;
  },
): Promise<PaymentMethod> {
  return apiFetch('/payment-methods', { method: 'POST', body: JSON.stringify(body) });
}

export function updatePaymentMethod(
  id: string,
  body: Omit<PaymentMethodInput, 'code'>,
): Promise<PaymentMethod> {
  return apiFetch(`/payment-methods/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export interface SalesPerson {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  countryCode: string | null;
  active: boolean;
}

export interface SalesPersonInput {
  code?: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  countryCode?: string | null;
  active?: boolean;
}

export function listSalesPersons(): Promise<SalesPerson[]> {
  return apiFetch('/sales-persons');
}

export function createSalesPerson(
  body: SalesPersonInput & { code: string; name: string },
): Promise<SalesPerson> {
  return apiFetch('/sales-persons', { method: 'POST', body: JSON.stringify(body) });
}

export function updateSalesPerson(
  id: string,
  body: Omit<SalesPersonInput, 'code'>,
): Promise<SalesPerson> {
  return apiFetch(`/sales-persons/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function applyCountryPreset(
  country: 'LK' | 'MY' | 'IN',
): Promise<{ marketSegments: number; businessSources: number; paymentMethods: number }> {
  return apiFetch('/configuration/apply-preset', {
    method: 'POST',
    body: JSON.stringify({ country }),
  });
}

export type ReservationKind =
  'confirm' | 'inquiry' | 'online_failed' | 'hold_confirm' | 'hold_unconfirm';

export interface PropertySettings {
  timeFormat: '12h' | '24h';
  mealCodeStyle: 'international' | 'indian';
  hold: { defaultHours: number; reminderHours: number };
  unconfirmedPolicy: 'never' | 'arrival_day_end';
  rateControl: { staffMaxDiscountPct: number; staffCanComp: boolean };
  requireDocumentsAtCheckin: boolean;
  /** `block`: check-out refuses an unpaid guest balance (owner may override with a reason). */
  checkoutBalancePolicy: 'block' | 'allow';
  kindOverrides: Partial<Record<ReservationKind, { label?: string; color?: string }>>;
  titles: string[] | null;
}

export type PropertySettingsPatch = Partial<
  Omit<PropertySettings, 'hold' | 'rateControl'> & {
    hold: Partial<PropertySettings['hold']>;
    rateControl: Partial<PropertySettings['rateControl']>;
  }
>;

export interface PropertyProfilePatch {
  name?: string;
  legalName?: string | null;
  code?: string | null;
  propertyType?:
    'Hotel' | 'Resort' | 'Guesthouse' | 'Villa' | 'Apartment' | 'Hostel' | 'Other' | null;
  countryCode?: string;
  stateCode?: string | null;
  state?: string | null;
  address?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  zip?: string | null;
  phone?: string | null;
  reservationPhone?: string | null;
  email?: string | null;
  website?: string | null;
  fax?: string | null;
  registrationNumber?: string | null;
  additionalRegistrationNumbers?: string[];
  latitude?: number | null;
  longitude?: number | null;
  logoMediaId?: string | null;
  timezone?: string;
  /** 'HH:MM' */
  checkinTime?: string;
  checkoutTime?: string;
  starRating?: number | null;
  /** Send '' for a key to clear it. */
  taxIds?: Partial<Record<keyof PropertyTaxIds, string>>;
  branchCode?: string | null;
  fyStartMonth?: number;
  invoicePrefix?: string | null;
}

export function updatePropertyProfile(id: string, body: PropertyProfilePatch): Promise<Property> {
  return apiFetch(`/properties/${id}/profile`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function getPropertySettings(id: string): Promise<PropertySettings> {
  return apiFetch(`/properties/${id}/settings`);
}

export function updatePropertySettings(
  id: string,
  body: PropertySettingsPatch,
): Promise<PropertySettings> {
  return apiFetch(`/properties/${id}/settings`, { method: 'PATCH', body: JSON.stringify(body) });
}

export interface ReservationKindOption {
  kind: ReservationKind;
  label: string;
  shortLabel: string;
  color: string;
  holdsInventory: boolean;
  isHold: boolean;
  quick: boolean;
}

export interface ReservationConfig {
  property: {
    id: string;
    name: string;
    code: string | null;
    legalName: string | null;
    countryCode: string;
    stateCode: string | null;
    currency: CurrencyCode;
    timezone: string;
    /** 'HH:MM' */
    checkinTime: string;
    checkoutTime: string;
  };
  /** The operating date: night audit's business date, or the property's calendar today. */
  today: string;
  todaySource: 'night_audit' | 'calendar';
  calendarToday: string;
  settings: PropertySettings;
  kinds: ReservationKindOption[];
  titles: string[];
  region: { country: string; cityLedgerLabel: string; taxRegistrationLabel: string };
  businessSources: Array<
    Pick<
      BusinessSource,
      | 'id'
      | 'shortCode'
      | 'name'
      | 'category'
      | 'palette'
      | 'defaultMarketSegmentId'
      | 'collectsTourismTax'
    >
  >;
  marketSegments: Array<{
    id: string;
    code: string;
    name: string;
    group: MarketSegmentGroup;
    palette: string;
    excludedFromSold: boolean;
  }>;
  paymentMethods: Array<
    Pick<
      PaymentMethod,
      | 'id'
      | 'code'
      | 'name'
      | 'shortName'
      | 'category'
      | 'requiresReference'
      | 'isDefaultCash'
      | 'isGuestAdvance'
      | 'currency'
    >
  >;
  salesPersons: Array<{ id: string; code: string; name: string }>;
  /** Travel agents and companies a reservation can be made for. */
  accounts: Array<{
    id: string;
    code: string;
    name: string;
    type: 'travel_agent' | 'company';
    defaultMarketSegmentId: string | null;
    hasContractRates: boolean;
  }>;
  /** The cash drawer shifts open right now: where cash taken with a reservation goes. */
  openDrawers: Array<{
    sessionId: string;
    drawerName: string;
    openedByUserId: string | null;
    openedAt: string;
  }>;
  /** Vehicles for pick-ups and drop-offs. */
  transportModes: Array<{ id: string; code: string; name: string; defaultPrice: string }>;
}

export function getReservationConfig(propertyId: string): Promise<ReservationConfig> {
  return apiFetch(`/properties/${propertyId}/reservation-config`);
}

export function stepUpApproval(body: {
  email: string;
  password: string;
  action: ApprovalAction;
  reason?: string;
}): Promise<{
  approvalToken: string;
  action: string;
  approver: { id: string; name: string; email: string };
  expiresAt: string;
}> {
  return apiFetch('/auth/step-up', { method: 'POST', body: JSON.stringify(body) });
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
  currency: 'LKR' | 'USD' | 'MYR' | 'INR',
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
  reviewRequired: boolean;
  reviewReason: string | null;
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

// --- Taking reservations (Development Phase 02) -----------------------------------

export type Residency = 'local' | 'foreign';
export type BookingOrigin = 'direct' | 'ota' | 'travel_agent' | 'corporate';

/** The room grid for a stay: GET /properties/:id/room-availability. */
export interface RoomAvailability {
  propertyId: string;
  checkin: string;
  checkout: string;
  nights: number;
  currency: CurrencyCode;
  roomTypes: Array<{
    roomId: string;
    name: string;
    quantity: number;
    /** Free on every night of the stay. */
    free: number;
    closedDates: string[];
    minStay: number;
    maxStay: number;
    rateTypes: Array<{
      ratePlanId: string;
      occupancyId: string;
      rateCode: string;
      rateName: string;
      label: string;
      accommodates: number;
      audience: 'all' | 'local' | 'foreign';
      marketSegmentId: string | null;
      priced: boolean;
      requiresGuestQuote?: boolean;
      policyVersion?: number | null;
      nightly: Array<{ date: string; price: string | null }>;
      total: string | null;
      average: string | null;
    }>;
    hiddenRateTypes: number;
    units: Array<{
      id: string;
      code: string;
      displayName?: string | null;
      floor: string | null;
      free: boolean;
      outOfService: boolean;
      blocked: boolean;
    }>;
  }>;
}

export function getRoomAvailability(
  propertyId: string,
  q: { checkin: string; checkout: string; residency?: Residency | null },
): Promise<RoomAvailability> {
  const params = new URLSearchParams({ checkin: q.checkin, checkout: q.checkout });
  if (q.residency) params.set('residency', q.residency);
  return apiFetch(`/properties/${propertyId}/room-availability?${params}`);
}

export type RateOverride =
  | { mode: 'nightly'; amount: number }
  | { mode: 'total'; amount: number }
  | { mode: 'per_night'; amounts: Record<string, number> }
  | { mode: 'discount_pct'; pct: number };

export interface ReservationLineInput {
  roomId: string;
  occupancyId: string;
  roomUnitId?: string | null;
  adults: number;
  children: number;
  childAges?: number[];
  extraBeds?: number;
  cots?: number;
  minimumExceptionReason?: string;
  rate?: RateOverride;
  /** Guest List: this room's own guest. */
  guest?: ReservationGuestInput;
  remarks?: RemarkInput[];
  /** Pro: work orders. */
  tasks?: TaskInput[];
  inclusions?: InclusionInput[];
  transfers?: TransferInput[];
}

export interface ReservationGuestInput {
  customerId?: string;
  title?: string;
  name?: string;
  email?: string;
  phone?: string;
  whatsapp?: boolean;
  nationalityCode?: string;
  countryCode?: string;
  state?: string;
  city?: string;
  address?: string;
  zip?: string;
  gender?: 'male' | 'female' | 'other';
  dateOfBirth?: string;
  documents?: GuestDocumentInput[];
  createNew?: boolean;
}

export type PriceApproval = 'rate_override' | 'complimentary' | 'tax_exempt';
/** Everything an owner can approve on the desk's screen (POST /auth/step-up). */
export type ApprovalAction = PriceApproval | 'refund' | 'checkout_balance';

/** What decides the price — shared by a quote and a reservation. */
export interface ReservationStayInput {
  propertyId: string;
  checkin: string;
  checkout: string;
  arrivalTime?: string;
  departureTime?: string;
  kind: ReservationKind;
  /** Omitted: the property's default hold length. null: never released. */
  holdUntil?: string | null;
  origin?: BookingOrigin;
  businessSourceId?: string;
  marketSegmentId?: string;
  salesPersonId?: string;
  ledgerAccountId?: string;
  voucherNo?: string;
  residency?: Residency;
  useContractRates?: boolean;
  complimentary?: boolean;
  taxExempt?: { exemptionId: string; reason?: string };
  priceReason?: string;
  approvals?: Partial<Record<PriceApproval, string>>;
  couponCode?: string;
  referralCode?: string;
  lines: ReservationLineInput[];
}

export interface ReservationQuote {
  propertyId: string;
  checkin: string;
  checkout: string;
  nights: number;
  currency: CurrencyCode;
  kind: ReservationKind;
  holdUntil: string | null;
  origin: BookingOrigin;
  marketSegmentId: string | null;
  lines: Array<{
    index: number;
    roomId: string;
    roomName: string;
    occupancyId: string;
    ratePlanId: string;
    rateCode: string;
    amount: string;
    taxes: string;
    listAmount: string;
    discountPct: number;
    rateSource: 'calendar' | 'override' | 'contract' | 'complimentary';
    couponDiscount: string;
    policyVersion?: number;
    nights: Array<{
      date: string;
      sellingPrice: string;
      listSellingPrice: string;
      tax: string;
      rateSource: string;
      smartQuote?: SmartNightQuote;
    }>;
    free: number;
    available: boolean;
  }>;
  totals: {
    amount: string;
    taxes: string;
    listAmount: string;
    discount: string;
    due: string;
    taxLines: Array<{ key: string; name: string; rate: number; amount: string }>;
  };
  approvalsRequired: PriceApproval[];
  reasonRequired: boolean;
  /** `exclusive_forward`: a typed rate is before tax (India, Malaysia — Sprint 7). */
  taxMode?: 'inclusive_legacy' | 'exclusive_forward';
  /** Levies owed on top of the price, charged on the folio per night stayed (Sprint 7). */
  levies?: Array<{ code: string; name: string; amount: number; nights: number; unit: number }>;
}

export function quoteReservation(body: ReservationStayInput): Promise<ReservationQuote> {
  return apiFetch('/reservations/quote', { method: 'POST', body: JSON.stringify(body) });
}

export interface ReservationOptionsInput {
  emailVoucher?: boolean;
  voucherEmails?: string[];
  sendCheckoutEmail?: boolean;
  checkoutTemplate?: string | null;
  guestPortalAccess?: boolean;
  suppressRateOnGrCard?: boolean;
  displayInclusionSeparately?: boolean;
}

/**
 * Who pays. `company` bills everything to the travel agent or company; `company_room_tax` bills
 * room and tax to them and extras to the guest; `group_owner` bills every room to the reservation's
 * guest. The company options are Pro (city ledger).
 */
export type BillTo = 'guest' | 'company' | 'group_owner' | 'company_room_tax';

/** Money taken with the reservation: a deposit, or the whole stay. */
export interface ReservationPaymentInput {
  paymentMethodId: string;
  amount: number;
  reference?: string;
  /** A slip photo, from uploadPrivateFile('payment_slip', …). */
  fileId?: string;
  drawerSessionId?: string;
}

export interface CreateReservationInput extends ReservationStayInput {
  guest: ReservationGuestInput;
  options?: ReservationOptionsInput;
  /** Notes for every room of the reservation. */
  remarks?: RemarkInput[];
  expectedTotal?: number;
  groupName?: string;
  billTo?: BillTo;
  payment?: ReservationPaymentInput;
  /** A walk-in: check in now. Arrival must be the property's today. */
  checkIn?: boolean;
}

export interface ReservationCreated {
  reference: string;
  groupId: string | null;
  kind: ReservationKind;
  status: 'Approved' | 'Pending' | 'CheckedIn';
  checkedIn: boolean;
  billTo: BillTo;
  payment: { receiptNo: string | null; amount: string; method: string } | null;
  /** Things the desk should know but that did not stop it, e.g. a dirty room. */
  warnings: string[];
  holdUntil: string | null;
  currency: CurrencyCode;
  total: string;
  taxes: string;
  discount: string;
  due: string;
  listTotal: string;
  guest: { id: string; name: string; created: boolean };
  bookings: Array<{
    id: string;
    reference: string;
    siblingIndex: number | null;
    roomId: string;
    roomName: string;
    occupancyId: string;
    rateCode: string;
    roomUnitId: string | null;
    roomCode: string | null;
    guestName: string;
    amount: string;
    taxes: string;
    discount: string;
    nights: number;
  }>;
}

/**
 * Book it. `idempotencyKey` makes a retry (a double-click, a lost response) return the first
 * reservation instead of making a second one — generate one per attempt at the form, not per call.
 */
export function createReservation(
  body: CreateReservationInput,
  idempotencyKey: string,
): Promise<ReservationCreated> {
  return apiFetch('/reservations', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export interface GuestMatch {
  id: string;
  title: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  mobileE164: string | null;
  whatsapp: boolean;
  nationalityCode: string | null;
  countryCode: string | null;
  vip: boolean;
  stays: number;
  lastStay: string | null;
}

export function searchGuests(q: string, limit = 6): Promise<GuestMatch[]> {
  return apiFetch(`/customers/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}

export function confirmBooking(id: string, reason?: string): Promise<Booking> {
  return apiFetch(`/bookings/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

export function holdBooking(
  id: string,
  body: { until: string | null; kind?: 'hold_confirm' | 'hold_unconfirm' },
): Promise<Booking> {
  return apiFetch(`/bookings/${id}/hold`, { method: 'POST', body: JSON.stringify(body) });
}

export function releaseHold(id: string, reason?: string): Promise<Booking> {
  return apiFetch(`/bookings/${id}/release-hold`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

// --- A booking's guests, remarks and tasks; guest documents (Phase 02, Sprint 4) ---------

export type RemarkType =
  'general' | 'front_desk' | 'housekeeping' | 'accounts' | 'kitchen' | 'preference';

export interface RemarkInput {
  type: RemarkType;
  text: string;
}

export type TaskDepartment =
  'housekeeping' | 'maintenance' | 'front_desk' | 'food_beverage' | 'transport' | 'other';
export type TaskTrigger = 'instant' | 'checkin' | 'checkout';

export interface TaskInput {
  title: string;
  description?: string;
  department: TaskDepartment;
  trigger: TaskTrigger;
  deadline?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

export type IdDocumentType =
  | 'nic'
  | 'mykad'
  | 'mypr'
  | 'aadhaar'
  | 'passport'
  | 'driving_licence'
  | 'voter_id'
  | 'oci'
  | 'other';

export interface GuestDocumentInput {
  type: IdDocumentType;
  number: string;
  issuingCountry?: string;
  placeOfIssue?: string;
  issuedOn?: string;
  expiresOn?: string;
  visaNumber?: string;
  visaType?: string;
  visaExpiresOn?: string;
  verification?: 'original' | 'copy' | 'digital';
  isPrimary?: boolean;
  /** A scan, from uploadPrivateFile('id_document', …). */
  fileId?: string;
}

export interface BookingRemark {
  id: string;
  type: RemarkType;
  text: string;
  createdAt: string;
  createdByUserId: string | null;
  createdByName: string | null;
}

export function getBookingRemarks(bookingId: string): Promise<BookingRemark[]> {
  return apiFetch(`/bookings/${bookingId}/remarks`);
}

export function addBookingRemark(bookingId: string, body: RemarkInput): Promise<BookingRemark> {
  return apiFetch(`/bookings/${bookingId}/remarks`, { method: 'POST', body: JSON.stringify(body) });
}

export function deleteBookingRemark(remarkId: string): Promise<{ id: string }> {
  return apiFetch(`/booking-remarks/${remarkId}`, { method: 'DELETE' });
}

export interface BookingGuestSummary {
  id: string;
  title: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  nationalityCode: string | null;
  vip: boolean;
}

export function getBookingGuests(
  bookingId: string,
): Promise<{ primary: BookingGuestSummary | null; others: BookingGuestSummary[] }> {
  return apiFetch(`/bookings/${bookingId}/guests`);
}

export function addBookingGuest(
  bookingId: string,
  body: ReservationGuestInput,
): Promise<{ customerId: string; name: string; created: boolean }> {
  return apiFetch(`/bookings/${bookingId}/guests`, { method: 'POST', body: JSON.stringify(body) });
}

export function removeBookingGuest(bookingId: string, customerId: string) {
  return apiFetch(`/bookings/${bookingId}/guests/${customerId}`, { method: 'DELETE' });
}

export interface BookingTask {
  id: string;
  title: string;
  description: string | null;
  department: TaskDepartment;
  trigger: TaskTrigger;
  priority: string;
  status: string;
  deadline: string | null;
  roomUnitId: string | null;
  roomCode: string | null;
  createdAt: string;
}

export function getBookingTasks(bookingId: string): Promise<BookingTask[]> {
  return apiFetch(`/bookings/${bookingId}/tasks`);
}

export function addBookingTask(bookingId: string, body: TaskInput): Promise<BookingTask> {
  return apiFetch(`/bookings/${bookingId}/tasks`, { method: 'POST', body: JSON.stringify(body) });
}

export interface GuestDocument extends Required<Pick<GuestDocumentInput, 'type' | 'number'>> {
  id: string;
  issuingCountry: string | null;
  placeOfIssue: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  visaNumber: string | null;
  visaType: string | null;
  visaExpiresOn: string | null;
  verification: 'original' | 'copy' | 'digital' | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export function getGuestDocuments(customerId: string): Promise<GuestDocument[]> {
  return apiFetch(`/customers/${customerId}/documents`);
}

export function addGuestDocument(
  customerId: string,
  body: GuestDocumentInput,
): Promise<GuestDocument> {
  return apiFetch(`/customers/${customerId}/documents`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function deleteGuestDocument(documentId: string) {
  return apiFetch(`/guest-documents/${documentId}`, { method: 'DELETE' });
}

// --- Inclusions, pick-ups and drop-offs (Phase 02, Sprint 5) -------------------------------

export type InclusionRhythm =
  'once' | 'per_night' | 'per_guest_per_night' | 'per_adult_per_night' | 'per_child_per_night';

/** Something the stay includes: breakfast, dinner, a driver's room. Posted by night audit. */
export interface InclusionInput {
  particularId?: string;
  name: string;
  rhythm: InclusionRhythm;
  /** Tax inclusive, per unit (a night, a guest-night …). */
  unitPrice: number;
  discountPct?: number;
  taxRatePct?: number;
  /** Already in the room rate: nothing is posted. */
  includedInRate?: boolean;
  itemize?: boolean;
}

export interface BookingInclusion {
  id: string;
  bookingId: string;
  particularId: string | null;
  name: string;
  rhythm: InclusionRhythm;
  unitPrice: string;
  discountPct: string;
  taxRatePct: string;
  includedInRate: boolean;
  itemize: boolean;
  createdAt: string;
}

export type TransferDirection = 'pickup' | 'dropoff';
export type TransferStatus = 'planned' | 'done' | 'cancelled';

export interface TransferInput {
  direction: TransferDirection;
  transportModeId?: string;
  /** ISO instant. */
  scheduledAt?: string;
  fromPlace?: string;
  toPlace?: string;
  flightNo?: string;
  pax?: number;
  vehicle?: string;
  driver?: string;
  /** Tax inclusive; 0 for a free transfer. Charged when marked done. */
  amount?: number;
  notes?: string;
}

export interface BookingTransfer {
  id: string;
  bookingId: string;
  direction: TransferDirection;
  transportModeId: string | null;
  modeName: string | null;
  scheduledAt: string | null;
  fromPlace: string | null;
  toPlace: string | null;
  flightNo: string | null;
  pax: number;
  vehicle: string | null;
  driver: string | null;
  amount: string;
  status: TransferStatus;
  chargeId: string | null;
  notes: string | null;
  createdAt: string;
}

export function getBookingInclusions(bookingId: string): Promise<BookingInclusion[]> {
  return apiFetch(`/bookings/${bookingId}/inclusions`);
}

export function addBookingInclusion(
  bookingId: string,
  body: InclusionInput,
): Promise<BookingInclusion> {
  return apiFetch(`/bookings/${bookingId}/inclusions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function removeBookingInclusion(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiFetch(`/booking-inclusions/${id}`, { method: 'DELETE' });
}

export function getBookingTransfers(bookingId: string): Promise<BookingTransfer[]> {
  return apiFetch(`/bookings/${bookingId}/transfers`);
}

export function addBookingTransfer(
  bookingId: string,
  body: TransferInput,
): Promise<BookingTransfer> {
  return apiFetch(`/bookings/${bookingId}/transfers`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Marking a transfer done posts its charge; cancelling a done one voids it. */
export function updateBookingTransfer(
  id: string,
  body: Partial<TransferInput> & { status?: TransferStatus },
): Promise<BookingTransfer> {
  return apiFetch(`/booking-transfers/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// --- Invoices, pro-formas and credit notes (Phase 02, Sprint 6) --------------------------

export type InvoiceKind =
  'legacy' | 'tax_invoice' | 'invoice' | 'bill' | 'proforma' | 'credit_note';
export type InvoiceProfile = 'lk_vat' | 'generic' | 'in_gst' | 'my_sst';

/** Supplier or purchaser, as printed on the document — frozen when it was issued. */
export interface InvoiceParty {
  name: string;
  legalName?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  taxId?: string | null;
  registrationNo?: string | null;
  branchCode?: string | null;
  /** India: the GST state code (place of supply). Sprint 7. */
  stateCode?: string | null;
  /** Malaysia: the Tourism Tax registration number. Sprint 7. */
  ttxNo?: string | null;
}

export interface InvoiceTaxTotal {
  key: string;
  name: string;
  rate: number;
  priority: number;
  amount: number;
}

export interface InvoiceLine {
  id: string;
  sort: number;
  description: string;
  quantity: string;
  unitPrice: string | null;
  /** Taxes excluded, and all taxes: `net + tax = amount`. */
  net: string | null;
  tax: string | null;
  amount: string;
  taxLines: Array<{
    key: string;
    name: string;
    rate: number;
    priority: number;
    amount: number;
  }> | null;
  hsnSac: string | null;
  postedFor: string | null;
  folioChargeId: string | null;
}

export interface InvoiceRow {
  id: string;
  propertyId: string;
  bookingId: string | null;
  folioId: string | null;
  number: string;
  kind: InvoiceKind;
  profile: InvoiceProfile;
  status: 'draft' | 'issued' | 'paid' | 'void';
  amount: string;
  currency: string;
  invoiceDate: string | null;
  issuedAt: string;
  creditedAt: string | null;
  originalInvoiceId: string | null;
  payerName: string | null;
  bookingReference: string | null;
  title: string;
}

export interface Invoice extends Omit<InvoiceRow, 'payerName' | 'bookingReference'> {
  supplier: InvoiceParty | null;
  payer: InvoiceParty | null;
  placeOfSupply: string | null;
  fiscalYear: string | null;
  supplyDate: string | null;
  subtotal: string | null;
  taxTotal: string | null;
  rounding: string;
  taxSummary: InvoiceTaxTotal[] | null;
  /** A foreign-currency invoice's rate to the local currency (`fxQuote`) on the invoice date. */
  fxRate: string | null;
  fxQuote: string | null;
  creditReason: string | null;
  notes: string | null;
  booking: { reference: string; checkin: string; checkout: string; guestName: string } | null;
  original: { id: string; number: string } | null;
  creditNotes: Array<{ id: string; number: string; creditReason: string | null }>;
  lines: InvoiceLine[];
}

export interface IssueInvoiceInput {
  /** What the desk types at the counter — a company's name and tax number for the invoice. */
  payer?: Partial<InvoiceParty>;
  notes?: string;
}

/** Invoice a folio window: a tax invoice and a bill in Sri Lanka, one invoice elsewhere. */
export function issueFolioInvoice(
  folioId: string,
  body: IssueInvoiceInput = {},
): Promise<{ documents: Invoice[] }> {
  return apiFetch(`/folios/${folioId}/invoice`, { method: 'POST', body: JSON.stringify(body) });
}

/** Invoice a booking's own bill, opening it if the stay never had one. */
export function issueBookingInvoice(
  bookingId: string,
  body: IssueInvoiceInput = {},
): Promise<{ documents: Invoice[] }> {
  return apiFetch(`/bookings/${bookingId}/invoices`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function createProforma(bookingId: string, body: IssueInvoiceInput = {}): Promise<Invoice> {
  return apiFetch(`/bookings/${bookingId}/proforma`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function createCreditNote(invoiceId: string, reason: string): Promise<Invoice> {
  return apiFetch(`/invoices/${invoiceId}/credit-note`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function listInvoices(
  query: {
    propertyId?: string;
    bookingId?: string;
    folioId?: string;
    kind?: InvoiceKind;
    from?: string;
    to?: string;
  } = {},
): Promise<InvoiceRow[]> {
  const q = new URLSearchParams(
    Object.entries(query).filter(([, v]) => Boolean(v)) as [string, string][],
  ).toString();
  return apiFetch(`/invoices${q ? `?${q}` : ''}`);
}

export function getInvoice(id: string): Promise<Invoice> {
  return apiFetch(`/invoices/${id}`);
}

export interface DocumentSeries {
  profile: InvoiceProfile;
  date: string;
  series: Array<{ docType: string; period: string; nextValue: number; updatedAt: string }>;
  /** What the next document of each kind would be numbered today. */
  next: Array<{ docType: string; period: string; number: string }>;
}

export function getDocumentSequences(propertyId: string): Promise<DocumentSeries> {
  return apiFetch(`/properties/${propertyId}/document-sequences`);
}

export function setDocumentSequence(
  propertyId: string,
  body: { docType: string; period: string; nextValue: number },
): Promise<{ docType: string; period: string; nextValue: number }> {
  return apiFetch(`/properties/${propertyId}/document-sequences`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// --- The booking voucher and the guest page (Phase 02, Sprint 6) --------------------------

export interface VoucherPreview {
  reference: string;
  subject: string;
  body: string;
  /** The guest and any addresses the reservation asked for. */
  recipients: string[];
  whatsappUrl: string;
  link: { url: string; expiresAt: string } | null;
}

export function previewVoucher(bookingId: string): Promise<VoucherPreview> {
  return apiFetch(`/reservations/${bookingId}/voucher/preview`, { method: 'POST' });
}

export function sendVoucher(
  bookingId: string,
  emails: string[],
): Promise<{ queued: number; recipients: string[] }> {
  return apiFetch(`/reservations/${bookingId}/voucher/send`, {
    method: 'POST',
    body: JSON.stringify({ emails }),
  });
}

export async function fetchDocumentPdf(kind: 'voucher' | 'invoice', id: string): Promise<Blob> {
  const path = kind === 'voucher' ? `/reservations/${id}/voucher/pdf` : `/invoices/${id}/pdf`;
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    endSessionIfTokenRejected(res.status, token);
    throw new ApiError(res.status, 'Could not open the document');
  }
  return res.blob();
}

export function sendInvoice(
  id: string,
  emails: string[],
): Promise<{ queued: number; recipients: string[] }> {
  return apiFetch(`/invoices/${id}/send`, { method: 'POST', body: JSON.stringify({ emails }) });
}

export function createVoucherLink(bookingId: string): Promise<{
  url: string;
  token: string;
  expiresAt: string;
  created: boolean;
  whatsappUrl: string;
}> {
  return apiFetch(`/reservations/${bookingId}/voucher/link`, { method: 'POST' });
}

export function revokeVoucherLink(bookingId: string): Promise<{ revoked: number }> {
  return apiFetch(`/reservations/${bookingId}/voucher/link`, { method: 'DELETE' });
}

/** The guest booking page — no login; the token in the link is the key. */
export interface GuestBookingPage {
  reference: string;
  status: string;
  guestFirstName: string;
  property: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    mapUrl: string | null;
    whatsappUrl: string | null;
  };
  checkin: string;
  checkout: string;
  checkinTime: string;
  checkoutTime: string;
  nights: number;
  rooms: Array<{ roomType: string; mealPlan: string | null; adults: number; children: number }>;
  currency: string;
  total: string;
  paid: string;
  balance: string;
}

export function getGuestBookingPage(token: string): Promise<GuestBookingPage> {
  return apiFetch(`/public/vouchers/${token}`);
}

export interface TransportMode {
  id: string;
  code: string;
  name: string;
  defaultPrice: string;
  sort: number;
  active: boolean;
}

export function listTransportModes(): Promise<TransportMode[]> {
  return apiFetch('/transport-modes');
}

export function createTransportMode(body: {
  code: string;
  name: string;
  defaultPrice?: number;
  sort?: number;
  active?: boolean;
}): Promise<TransportMode> {
  return apiFetch('/transport-modes', { method: 'POST', body: JSON.stringify(body) });
}

export function updateTransportMode(
  id: string,
  body: { name?: string; defaultPrice?: number; sort?: number; active?: boolean },
): Promise<TransportMode> {
  return apiFetch(`/transport-modes/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ---------------------------------------------------------------------------------------------
// UX measurement (UX Excellence Program, UX-0) — see docs/UX-STANDARD.md. No guest data, ever.

export type UxEventKind = 'task' | 'client_error' | 'survey_shown' | 'survey_dismissed';

export interface UxEvent {
  kind: UxEventKind;
  task?: string;
  outcome?: 'completed' | 'abandoned';
  durationMs?: number;
  clicks?: number;
  fields?: number;
  route?: string;
  appVersion?: string;
}

/**
 * Fire-and-forget: `keepalive` lets the batch leave during page unload, and a failure is dropped
 * on purpose. Measuring the product must never be the reason something in it breaks.
 */
export function postUxEvents(events: UxEvent[]): void {
  const token = getToken();
  if (!token || events.length === 0) return;
  void fetch(`${API_BASE}/ux/events`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ events }),
  }).catch(() => {});
}

export interface UxSurvey {
  eligible: boolean;
  items: Array<{ key: string; text: string }>;
}

export function getUxSurvey(): Promise<UxSurvey> {
  return apiFetch('/ux/survey');
}

export function answerUxSurvey(body: {
  answers: Record<string, number>;
  comment?: string;
}): Promise<{ saved: true }> {
  return apiFetch('/ux/survey', { method: 'POST', body: JSON.stringify(body) });
}

export interface UxScoreboard {
  days: number;
  tasks: Array<{
    task: string;
    completed: number;
    abandoned: number;
    medianMs: number | null;
    p90Ms: number | null;
    medianClicks: number | null;
  }>;
  survey: Array<{
    key: string;
    text: string;
    responses: number;
    agreePct: number | null;
    mean: number | null;
    baselinePct: number;
  }>;
  clientErrors: number;
  mistakes: { quickVoids: number; quickCancels: number; quickCreditNotes: number };
}

export function getUxScoreboard(days = 30, tenantId?: string): Promise<UxScoreboard> {
  const q = new URLSearchParams({ days: String(days) });
  if (tenantId) q.set('tenantId', tenantId);
  return apiFetch(`/staff/ux/scoreboard?${q.toString()}`);
}

// --- Malaysia & India money and compliance (Development Phase 02, Sprint 7) ------------------

export interface TaxRateRow {
  ratePercent: number;
  minAmount: number | null;
  maxAmount: number | null;
  startDate: string;
  endDate: string;
}

export interface PropertyTaxes {
  propertyId: string;
  countryCode: string;
  currency: string;
  taxMode: 'inclusive_legacy' | 'exclusive_forward';
  taxes: Array<{
    id: string;
    name: string;
    code: string | null;
    invoiceLabel: string | null;
    priority: number;
    compound: boolean;
    exemptible: boolean;
    displayGroup: string;
    rates: TaxRateRow[];
  }>;
  levies: Array<{
    code: string;
    name: string;
    amount: string;
    currency: string;
    appliesTo: 'non_resident' | 'all';
    validFrom: string | null;
    validTo: string | null;
    active: boolean;
  }>;
  preset: { available: boolean; enabled: boolean; currency: string | null; applied: boolean };
}

export function getPropertyTaxes(propertyId: string): Promise<PropertyTaxes> {
  return apiFetch(`/properties/${propertyId}/taxes`);
}

export function applyTaxPreset(
  propertyId: string,
): Promise<PropertyTaxes & { repriced: number; repricedFrom: string }> {
  return apiFetch(`/properties/${propertyId}/taxes/apply-preset`, { method: 'POST' });
}

export interface StayRegistration {
  bookingId: string;
  arrivedFrom: string | null;
  arrivedInCountryOn: string | null;
  portOfEntry: string | null;
  nextDestination: string | null;
  purposeOfVisit: string | null;
  formC: {
    required: boolean;
    status: 'not_required' | 'pending' | 'submitted';
    reference: string | null;
    submittedAt: string | null;
    dueAt: string | null;
  };
  guestRegister: { required: boolean; missing: string[] };
}

export function getStayRegistration(bookingId: string): Promise<StayRegistration> {
  return apiFetch(`/bookings/${bookingId}/registration`);
}

export function saveStayRegistration(
  bookingId: string,
  body: Partial<
    Pick<
      StayRegistration,
      'arrivedFrom' | 'arrivedInCountryOn' | 'portOfEntry' | 'nextDestination' | 'purposeOfVisit'
    >
  >,
): Promise<StayRegistration> {
  return apiFetch(`/bookings/${bookingId}/registration`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function submitFormC(bookingId: string, reference: string): Promise<StayRegistration> {
  return apiFetch(`/bookings/${bookingId}/form-c`, {
    method: 'POST',
    body: JSON.stringify({ reference }),
  });
}

export interface FormCRow {
  bookingId: string;
  reference: string;
  guestName: string;
  nationalityCode: string | null;
  status: string;
  checkin: string;
  checkout: string;
  checkedInAt: string;
  dueAt: string;
  submitted: boolean;
  overdue: boolean;
  hoursLeft: number | null;
  formCReference: string | null;
  submittedAt: string | null;
}

export function getFormCTracker(
  propertyId: string,
): Promise<{ required: boolean; pending?: number; overdue?: number; rows: FormCRow[] }> {
  return apiFetch(`/properties/${propertyId}/form-c`);
}

// --- One search for the desk (UX-2) -----------------------------------------

export interface SearchReservation {
  id: string;
  reference: string;
  status: string;
  checkin: string;
  checkout: string;
  rooms: number;
  currency: string;
  amount: string;
  guestName: string;
  guestPhone: string | null;
  vip: boolean;
  /** The rooms this stay holds, e.g. "101, 102". */
  roomCodes: string | null;
}

export interface SearchGuest {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  vip: boolean;
  companyName: string | null;
  stays: number;
  lastStay: string | null;
}

export interface SearchRoom {
  id: string;
  code: string;
  floor: string | null;
  status: string;
  bookingId: string | null;
  reference: string | null;
  guestName: string | null;
}

export interface SearchResults {
  query: string;
  /** The hotel's own date, so the palette can say "arriving today". */
  today: string | null;
  reservations: SearchReservation[];
  guests: SearchGuest[];
  rooms: SearchRoom[];
}

/** Search the whole hotel: reference, guest, phone, voucher or room number. */
export function searchEverything(propertyId: string, q: string): Promise<SearchResults> {
  return apiFetch(`/search?propertyId=${propertyId}&q=${encodeURIComponent(q)}`);
}

export interface BulkResult {
  done: number;
  failed: number;
  results: Array<{
    id: string;
    ok: boolean;
    reference?: string | null;
    reason?: string;
    message?: string;
  }>;
}

/** The same desk action over a selection; each stay stands or falls on its own (UX-2). */
export function bulkDeskAction(
  action: 'check-in' | 'check-out' | 'assign-rooms',
  ids: string[],
): Promise<BulkResult> {
  const path = action === 'assign-rooms' ? 'bulk/assign-rooms' : `bulk/${action}`;
  return apiFetch(`/bookings/${path}`, { method: 'POST', body: JSON.stringify({ ids }) });
}
