import type { Prisma } from '../../generated/prisma/client.ts';
import { formatClock, localDateOf, localMinuteOf } from '../../lib/time.ts';

export const BOOKING_INCLUDE = {
  professional: { select: { id: true, displayName: true } },
  location: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, phoneE164: true } },
} as const;

export type BookingRow = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

export function toBookingDto(b: BookingRow, timezone: string) {
  return {
    id: b.id,
    status: b.status,
    startAt: b.startAt,
    endAt: b.endAt,
    localDate: localDateOf(b.startAt, timezone),
    localTime: formatClock(localMinuteOf(b.startAt, timezone)),
    service: { id: b.serviceId, name: b.serviceNameSnapshot, durationMinutes: b.durationMinutesSnapshot },
    priceCents: b.priceCentsSnapshot,
    currency: b.currencySnapshot,
    professional: b.professional,
    location: b.location,
    customer: b.customer,
    customerNotes: b.customerNotes,
    source: b.source,
    cancelledAt: b.cancelledAt,
    cancelReason: b.cancelReason,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}
export type BookingDto = ReturnType<typeof toBookingDto>;
