import type { Locale } from '@autocontent/shared';

/**
 * A form a module can ask the core "collect missing info" flow to render
 * (e.g. price/mileage/city after a vehicle photo is analysed). Not consumed
 * by anything yet — declared now so a module's shape includes it ahead of
 * the flow that will read it.
 */
export interface FormField {
  key: string;
  label: Record<Locale, string>;
  kind: 'text' | 'number' | 'select';
  options?: string[];
}

export interface FormDefinition {
  /** e.g. "vehicle-missing-info" */
  id: string;
  fields: FormField[];
}
