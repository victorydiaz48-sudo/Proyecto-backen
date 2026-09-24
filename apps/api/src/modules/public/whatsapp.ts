/**
 * Enlace wa.me para que el cliente avise al negocio de la cita ya creada (el backend es la fuente de
 * verdad; WhatsApp solo notifica). Mismo formato de texto que el generador: resumen línea a línea.
 */
export function bookingWhatsappUrl(
  phoneE164: string,
  locale: string,
  b: { businessName: string; customerName: string; serviceName: string; professionalName: string; localDate: string; localTime: string },
): string {
  const es = locale.startsWith('es');
  const [y, m, d] = b.localDate.split('-');
  const lines = es
    ? ['Hola, acabo de reservar una cita:', '', `*${b.businessName}*`, '', `Nombre: ${b.customerName}`, `Servicio: ${b.serviceName}`, `Profesional: ${b.professionalName}`, `Fecha: ${d}/${m}/${y}`, `Hora: ${b.localTime}`]
    : ['Olá, acabei de agendar um horário:', '', `*${b.businessName}*`, '', `Nome: ${b.customerName}`, `Serviço: ${b.serviceName}`, `Profissional: ${b.professionalName}`, `Data: ${d}/${m}/${y}`, `Horário: ${b.localTime}`];
  return `https://wa.me/${phoneE164.replace(/\D/g, '')}?text=${encodeURIComponent(lines.join('\n'))}`;
}
