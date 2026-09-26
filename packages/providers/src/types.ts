import type { Logger, UnitType } from '@autocontent/shared';

/** Passed to every provider call. */
export interface ProviderCallOptions {
  jobId: string;
  organizationId: string;
  /** Forwarded to the vendor when it supports idempotency keys. */
  idempotencyKey: string;
  /** Hard deadline set by the caller. Adapters must stop work when it aborts. */
  signal: AbortSignal;
  logger: Logger;
}

/**
 * What a call consumed. Adapters report usage only; money is computed from the
 * provider's configured costConfig (never hardcoded in adapters or business
 * logic) by computeCostMicros().
 */
export { UNIT_TYPES, type UnitType } from '@autocontent/shared';

export interface ProviderUsage {
  unitType: UnitType;
  units: number;
}

export interface ProviderResult<T> {
  data: T;
  usage: ProviderUsage[];
  /** Vendor model/version actually used, for GenerationLog. */
  model: string;
  latencyMs: number;
  /** Small, secret-free summary of the raw response for GenerationLog. */
  rawSummary?: unknown;
}

/** Rejects with the signal's reason if it is (or becomes) aborted. */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Aborted');
}

/** A delay that ends early when the signal aborts (used by mocks). */
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
