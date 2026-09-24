import type { FastifyBaseLogger } from 'fastify';

export interface OutgoingMessage {
  id: string;
  tenantId: string;
  /** Canal lógico ('whatsapp'); el transporte decide cómo se entrega. */
  channel: string;
  /** E.164 */
  to: string;
  text: string;
}

/**
 * Cómo se entrega un aviso. La lógica de reservas nunca conoce el transporte: solo escribe en el outbox.
 * Un transporte lanza un error si el envío falla (el worker reintenta con espera creciente).
 * Implementaciones: LogTransport (opción C, sin proveedor). Futuro: WhatsApp Business Cloud API.
 */
export interface NotificationTransport {
  readonly name: string;
  send(message: OutgoingMessage): Promise<void>;
}

/** Solo registra el aviso (sin datos personales en el log). No envía nada fuera. */
export class LogTransport implements NotificationTransport {
  readonly name = 'log';
  constructor(private readonly log: Pick<FastifyBaseLogger, 'info'>) {}

  async send(m: OutgoingMessage): Promise<void> {
    this.log.info(
      { notificationId: m.id, tenantId: m.tenantId, channel: m.channel, to: `${m.to.slice(0, 4)}…${m.to.slice(-2)}`, length: m.text.length },
      'aviso registrado (transporte log: sin envío real)',
    );
  }
}

/** Enlace wa.me con el texto del aviso, para enviarlo a mano desde el panel. */
export const waLink = (to: string, text: string): string => `https://wa.me/${to.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
