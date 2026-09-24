// Textos de los avisos (portugués y español, como el generador). Se renderizan al encolar: si la cita
// cambia después, los avisos pendientes se cancelan y se encolan otros con los datos nuevos.

export type TemplateKey =
  | 'customer.booking_created'
  | 'customer.booking_received'
  | 'customer.booking_confirmed'
  | 'customer.booking_rescheduled'
  | 'customer.booking_cancelled'
  | 'customer.booking_reminder'
  | 'business.booking_created';

export interface TemplateData {
  businessName: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  professionalName: string;
  locationName: string;
  /** YYYY-MM-DD local del negocio */
  localDate: string;
  localTime: string;
  notes?: string | null;
}

const dmy = (d: string): string => {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

const pt = (key: TemplateKey, d: TemplateData): string[] => {
  const when = `${dmy(d.localDate)} às ${d.localTime}`;
  const detail = [`Serviço: ${d.serviceName}`, `Profissional: ${d.professionalName}`, `Local: ${d.locationName}`];
  switch (key) {
    case 'customer.booking_created':
      return [`Olá, ${d.customerName}! Seu horário na *${d.businessName}* está confirmado para ${when}.`, '', ...detail];
    case 'customer.booking_received':
      return [`Olá, ${d.customerName}! Recebemos seu pedido na *${d.businessName}* para ${when}. Vamos confirmar em breve.`, '', ...detail];
    case 'customer.booking_confirmed':
      return [`Olá, ${d.customerName}! Seu horário na *${d.businessName}* para ${when} foi confirmado.`, '', ...detail];
    case 'customer.booking_rescheduled':
      return [`Olá, ${d.customerName}! Seu horário na *${d.businessName}* foi alterado para ${when}.`, '', ...detail];
    case 'customer.booking_cancelled':
      return [`Olá, ${d.customerName}. Seu horário na *${d.businessName}* de ${when} foi cancelado.`];
    case 'customer.booking_reminder':
      return [`Lembrete: amanhã, ${when}, você tem horário na *${d.businessName}*.`, '', ...detail];
    case 'business.booking_created':
      return [
        `Novo agendamento pelo site — *${d.businessName}*`,
        '',
        `Cliente: ${d.customerName} (${d.customerPhone})`,
        `Data: ${dmy(d.localDate)}`,
        `Horário: ${d.localTime}`,
        ...detail,
        ...(d.notes ? [`Observações: ${d.notes}`] : []),
      ];
  }
};

const es = (key: TemplateKey, d: TemplateData): string[] => {
  const when = `${dmy(d.localDate)} a las ${d.localTime}`;
  const detail = [`Servicio: ${d.serviceName}`, `Profesional: ${d.professionalName}`, `Local: ${d.locationName}`];
  switch (key) {
    case 'customer.booking_created':
      return [`¡Hola, ${d.customerName}! Tu cita en *${d.businessName}* está confirmada para el ${when}.`, '', ...detail];
    case 'customer.booking_received':
      return [`¡Hola, ${d.customerName}! Recibimos tu solicitud en *${d.businessName}* para el ${when}. Te la confirmaremos pronto.`, '', ...detail];
    case 'customer.booking_confirmed':
      return [`¡Hola, ${d.customerName}! Tu cita en *${d.businessName}* del ${when} está confirmada.`, '', ...detail];
    case 'customer.booking_rescheduled':
      return [`¡Hola, ${d.customerName}! Tu cita en *${d.businessName}* se ha cambiado al ${when}.`, '', ...detail];
    case 'customer.booking_cancelled':
      return [`Hola, ${d.customerName}. Tu cita en *${d.businessName}* del ${when} ha sido cancelada.`];
    case 'customer.booking_reminder':
      return [`Recordatorio: mañana, ${when}, tienes cita en *${d.businessName}*.`, '', ...detail];
    case 'business.booking_created':
      return [
        `Nueva cita desde la web — *${d.businessName}*`,
        '',
        `Cliente: ${d.customerName} (${d.customerPhone})`,
        `Fecha: ${dmy(d.localDate)}`,
        `Hora: ${d.localTime}`,
        ...detail,
        ...(d.notes ? [`Notas: ${d.notes}`] : []),
      ];
  }
};

export function renderTemplate(key: TemplateKey, locale: string, data: TemplateData): string {
  return (locale.toLowerCase().startsWith('es') ? es : pt)(key, data).join('\n');
}
