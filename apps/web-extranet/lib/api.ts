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
): Promise<{ opened: number }> {
  return apiFetch(`/rooms/${roomId}/availability`, {
    method: 'POST',
    body: JSON.stringify({ from, to, roomsToSell }),
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
  rateCode: string;
  accommodates: number;
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
