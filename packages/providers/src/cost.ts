import type { CostConfig } from '@autocontent/shared';
import type { ProviderUsage } from './types.js';

export { costConfigSchema, type CostConfig } from '@autocontent/shared';

export interface CostBreakdown {
  totalMicros: bigint;
  /** Usage lines with no configured price: charged 0 and flagged for the status page. */
  unpriced: ProviderUsage[];
}

export function computeCostMicros(config: CostConfig, usage: readonly ProviderUsage[]): CostBreakdown {
  let total = 0;
  const unpriced: ProviderUsage[] = [];
  for (const u of usage) {
    const price = config.find((c) => c.unitType === u.unitType);
    if (!price) {
      if (u.units > 0) unpriced.push(u);
      continue;
    }
    total += u.units * price.costMicros;
  }
  return { totalMicros: BigInt(Math.round(total)), unpriced };
}
