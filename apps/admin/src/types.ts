// Formas de las respuestas de la API que usa el panel (ver docs/API.md).
export type Role = 'ADMIN' | 'PROFESSIONAL';
export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface Me {
  user: { id: string; email: string; role: Role; professionalId: string | null };
  tenant: { id: string; slug: string; name: string; timezone: string; currency: string; locale: string };
}

export interface Settings {
  slug: string;
  name: string;
  timezone: string;
  defaultCountryCode: string;
  currency: string;
  locale: string;
  slotIntervalMinutes: number;
  defaultBookingStatus: 'PENDING' | 'CONFIRMED';
  bookingLeadMinutes: number;
  bookingHorizonDays: number;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  durationMinutes: number;
  bufferAfterMinutes: number;
  priceCents: number;
  active: boolean;
  sortOrder: number;
}

export interface Professional {
  id: string;
  displayName: string;
  title: string | null;
  bio: string | null;
  photoUrl: string | null;
  active: boolean;
  sortOrder: number;
  userId: string | null;
  serviceIds: string[];
}

export interface Location {
  id: string;
  name: string;
  address: string | null;
  mapsUrl: string | null;
  whatsapp: string | null;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
}

export interface WorkingInterval {
  id?: string;
  locationId: string;
  weekday: number;
  start: string;
  end: string;
}

export interface TimeBlock {
  id: string;
  professionalId: string | null;
  locationId: string | null;
  startAt: string;
  endAt: string;
  reason: string | null;
}

export interface Customer {
  id: string;
  name: string;
  phoneE164: string;
  email: string | null;
  notes: string | null;
}

export interface Booking {
  id: string;
  status: BookingStatus;
  startAt: string;
  endAt: string;
  localDate: string;
  localTime: string;
  service: { id: string; name: string; durationMinutes: number };
  priceCents: number;
  currency: string;
  professional: { id: string; displayName: string };
  location: { id: string; name: string };
  customer: { id: string; name: string; phoneE164: string };
  customerNotes: string | null;
  source: 'PUBLIC_WEB' | 'ADMIN' | 'PROFESSIONAL';
  cancelReason: string | null;
}

export interface Slot {
  startAt: string;
  localTime: string;
  locationId: string;
  professionalIds: string[];
}

export interface Availability {
  timezone: string;
  durationMinutes: number;
  days: { date: string; slots: Slot[] }[];
}

export interface User {
  id: string;
  email: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
  professionalId: string | null;
  professional: { id: string; displayName: string } | null;
}

export interface AuditLog {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorType: 'USER' | 'PUBLIC' | 'SYSTEM';
  actor: { id: string; email: string } | null;
  before: unknown;
  after: unknown;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string | null;
}

export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED';

export interface TelegramStatus {
  available: boolean;
  linked: boolean;
  linkedAt: string | null;
}

export interface Notification {
  id: string;
  bookingId: string | null;
  channel: 'whatsapp' | 'telegram';
  audience: 'CUSTOMER' | 'BUSINESS';
  template: string;
  status: NotificationStatus;
  to: string;
  text: string;
  waUrl: string | null;
  attempts: number;
  lastError: string | null;
  scheduledFor: string;
  sentAt: string | null;
  createdAt: string;
}
