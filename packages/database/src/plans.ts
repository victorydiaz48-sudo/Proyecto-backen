import { usdToMicros } from '@autocontent/shared';

/**
 * Subscription plan definitions. Data, not business logic: a Subscription row
 * copies these limits when created, so changing a plan here never silently
 * changes existing customers.
 */
export interface PlanDefinition {
  code: string;
  name: string;
  periodDays: number;
  dailyJobLimit: number | null;
  monthlyVehicleLimit: number | null;
  monthlyVideoLimit: number | null;
  monthlyCostCapMicros: bigint | null;
}

export const PLANS: Record<string, PlanDefinition> = {
  trial: {
    code: 'trial',
    name: 'Trial',
    periodDays: 30,
    dailyJobLimit: 50,
    monthlyVehicleLimit: 200,
    monthlyVideoLimit: 20,
    monthlyCostCapMicros: usdToMicros(25),
  },
};
