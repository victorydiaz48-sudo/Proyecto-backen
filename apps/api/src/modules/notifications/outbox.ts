import type { Tx } from '../../db.ts';
import type { BookingSource, BookingStatus } from '../../generated/prisma/enums.ts';
import { renderTemplate, type TemplateData, type TemplateKey } from './templates.ts';

export const REMINDER_HOURS_BEFORE = 24;
const HOUR_MS = 3_600_000;

export type BookingEvent = 'created' | 'confirmed' | 'rescheduled' | 'cancelled';

export interface BookingForNotification {
  id: string;
  status: BookingStatus;
  startAt: Date;
  localDate: string;
  localTime: string;
  service: { name: string };
  professional: { displayName: string };
  location: { id: string; name: string };
  customer: { name: string; phoneE164: string };
  customerNotes: string | null;
}

/**
 * Encola los avisos de un cambio de cita. Se llama DENTRO de la misma transacción que el cambio: si la
 * cita no se guarda, tampoco los avisos; si se guarda, los avisos no se pierden aunque WhatsApp falle.
 *
 * - Cliente: confirmación (o "recibida" si queda PENDING), confirmada, movida, cancelada, y un
 *   recordatorio 24 h antes para citas confirmadas.
 * - Negocio: cada cita nueva que llega desde la web, al WhatsApp de su local (o del local por defecto).
 *   Lo que hace el propio negocio en el panel no se le notifica a sí mismo.
 * - Al mover o cancelar, los avisos aún no enviados de esa cita (p. ej. el recordatorio) se cancelan.
 */
export async function enqueueBookingNotifications(
  tx: Tx,
  args: {
    tenant: { id: string; name: string; locale: string };
    booking: BookingForNotification;
    event: BookingEvent;
    source: BookingSource;
    now: Date;
  },
): Promise<void> {
  const { tenant, booking: b, event, now } = args;

  if (event === 'rescheduled' || event === 'cancelled') {
    await tx.notificationOutbox.updateMany({
      where: { tenantId: tenant.id, bookingId: b.id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  }

  const data: TemplateData = {
    businessName: tenant.name,
    customerName: b.customer.name,
    customerPhone: b.customer.phoneE164,
    serviceName: b.service.name,
    professionalName: b.professional.displayName,
    locationName: b.location.name,
    localDate: b.localDate,
    localTime: b.localTime,
    notes: b.customerNotes,
  };
  const rows: { audience: 'CUSTOMER' | 'BUSINESS'; template: TemplateKey; to: string; at: Date }[] = [];
  const customer = (template: TemplateKey, at = now) => rows.push({ audience: 'CUSTOMER', template, to: b.customer.phoneE164, at });

  if (event === 'created') customer(b.status === 'PENDING' ? 'customer.booking_received' : 'customer.booking_created');
  if (event === 'confirmed') customer('customer.booking_confirmed');
  if (event === 'rescheduled') customer('customer.booking_rescheduled');
  if (event === 'cancelled') customer('customer.booking_cancelled');

  const reminderAt = new Date(b.startAt.getTime() - REMINDER_HOURS_BEFORE * HOUR_MS);
  if (b.status === 'CONFIRMED' && event !== 'cancelled' && reminderAt > now) customer('customer.booking_reminder', reminderAt);

  if (event === 'created' && args.source === 'PUBLIC_WEB') {
    const location = await tx.location.findFirst({ where: { tenantId: tenant.id, id: b.location.id }, select: { whatsapp: true } });
    const fallback = location?.whatsapp ? null : await tx.location.findFirst({ where: { tenantId: tenant.id, isDefault: true }, select: { whatsapp: true } });
    const to = location?.whatsapp ?? fallback?.whatsapp;
    if (to) rows.push({ audience: 'BUSINESS', template: 'business.booking_created', to, at: now });
  }

  if (rows.length === 0) return;
  await tx.notificationOutbox.createMany({
    data: rows.map((r) => ({
      tenantId: tenant.id,
      bookingId: b.id,
      channel: 'whatsapp',
      audience: r.audience,
      template: r.template,
      payload: { to: r.to, text: renderTemplate(r.template, tenant.locale, data), locale: tenant.locale },
      nextAttemptAt: r.at,
    })),
  });
}
