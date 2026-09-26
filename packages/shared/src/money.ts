/**
 * Costs are tracked internally in integer micro-USD (1 USD = 1_000_000) so
 * sums are exact. Conversion to an organization's display currency happens only
 * at the edges (dashboard, bot messages).
 */
export const MICROS_PER_USD = 1_000_000n;

export function usdToMicros(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

export function microsToUsd(micros: bigint): number {
  return Number(micros) / 1_000_000;
}

/** Converts micro-USD to a display currency. `usdRate` = units of `currency` per 1 USD. */
export function formatMicros(micros: bigint, currency = 'USD', usdRate = 1, locale = 'en'): string {
  const amount = microsToUsd(micros) * usdRate;
  // Sub-cent amounts are common for single API calls; show them instead of "0.00".
  const digits = amount !== 0 && Math.abs(amount) < 0.01 ? 4 : 2;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}
