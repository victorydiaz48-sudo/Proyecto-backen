import type { z } from 'zod';

/**
 * Documents and validates one entity a vertical module owns (e.g. "Vehicle").
 * Deliberately thin: this is not a generic ORM/repository abstraction — a
 * module talks to its own Prisma tables directly (see ARCHITECTURE and
 * docs/phase-3-design.md §11, "not worth abstracting yet"). `zodSchema` is
 * used to validate data at API/job boundaries, not to generate SQL.
 */
export interface EntitySchema<T = unknown> {
  /** e.g. "Vehicle" */
  readonly name: string;
  readonly zodSchema: z.ZodType<T>;
}
