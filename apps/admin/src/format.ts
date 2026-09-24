// Formato y fechas en la zona del NEGOCIO (no la del navegador: el dueño puede estar de viaje).

export function money(cents: number, currency: string, lang: string): string {
  return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'pt-BR', { style: 'currency', currency }).format(cents / 100);
}

/** "R$ 45,00" / "45.5" / "45" → céntimos. null si no es un importe válido. */
export function parseMoney(text: string): number | null {
  const s = text.replace(/[^\d,.-]/g, '').trim();
  if (!s) return null;
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  const normalized = lastSep >= 0 && s.length - lastSep - 1 <= 2
    ? `${s.slice(0, lastSep).replace(/[.,]/g, '')}.${s.slice(lastSep + 1)}`
    : s.replace(/[.,]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** Fecha local (YYYY-MM-DD) de un instante en la zona `tz`. */
export function localDate(instant: Date, tz: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function localTime(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(instant);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Desfase (minutos) de la zona `tz` respecto a UTC en un instante. */
function offsetMinutes(instant: Date, tz: string): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** Fecha y hora locales del negocio → ISO 8601 con su desfase (lo que pide la API para bloqueos). */
export function zonedIso(date: string, time: string, tz: string): string {
  const guess = new Date(`${date}T${time}:00Z`);
  let off = offsetMinutes(guess, tz);
  off = offsetMinutes(new Date(guess.getTime() - off * 60000), tz);
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${date}T${time}:00${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export function dateTimeLabel(iso: string, tz: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

export function dateLabel(date: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00Z`));
}
