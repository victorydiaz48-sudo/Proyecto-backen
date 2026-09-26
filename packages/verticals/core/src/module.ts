import type { RouteContract } from '@autocontent/contracts';
import type { ContentFormat, ContentTemplate, VideoStyle } from '@autocontent/templates';
import type { Locale } from '@autocontent/shared';
import type { z } from 'zod';
import type { EntitySchema } from './entity.js';
import { VerticalRegistryError } from './errors.js';
import type { PromptProvider } from './prompts.js';
import type { WorkflowHooks } from './workflow.js';

/** A module's content templates, formats and video styles (its contribution to the core catalogue shape from packages/templates). */
export interface ContentTemplateSet {
  templates: ContentTemplate[];
  formats: ContentFormat[];
  videoStyles: VideoStyle[];
}

/**
 * Free-form message fragment a module contributes for one locale. Not
 * spliced into the core `Messages` type (that stays closed and generic);
 * module code looks its own fragment up directly. Validated only for key
 * collisions across modules (VerticalRegistry, at registration time).
 */
export type MessageFragment = Record<string, unknown>;

/**
 * Everything a vertical module registers with the platform. Built by
 * `defineVerticalModule()`, held by `VerticalRegistry`. Core code never
 * imports a concrete module — only this interface and the registry.
 */
export interface VerticalModule<TConfig = unknown, TAnalysis = unknown> {
  /** Stable slug, e.g. "dealership". Namespaces this module's subjectType values ("dealership.vehicle"). */
  readonly slug: string;
  readonly displayName: string;
  /** Validates VerticalEnrollment.config for organizations enrolled in this module. */
  readonly configSchema: z.ZodType<TConfig>;

  readonly entities: EntitySchema[];
  readonly workflow: WorkflowHooks<TAnalysis>;
  /** Storage key path segment for this module's subject photos, e.g. "vehicles" (see storageKey() in @autocontent/providers). */
  readonly storagePathSegment: string;
  /** Absent for verticals with no AI-driven copy generation step. */
  readonly prompts?: PromptProvider;
  readonly contentTemplates: ContentTemplateSet;
  /** Merged into the core route table at server startup. */
  readonly routes: RouteContract[];
  readonly messages: Partial<Record<Locale, MessageFragment>>;

  /**
   * Path to this module's Prisma schema fragment (a `.prisma` file merged
   * into packages/database/prisma/ at build/dev time — see
   * docs/phase-3-design.md §8.1). Absent for a module that owns no tables.
   */
  readonly prismaSchemaPath?: string;
}

const SLUG = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Validates a module's own shape (not cross-module collisions — that's the
 * registry's job) and returns it unchanged. Every module calls this once, at
 * the bottom of its `module.ts`.
 */
export function defineVerticalModule<TConfig, TAnalysis = unknown>(
  module: VerticalModule<TConfig, TAnalysis>,
): VerticalModule<TConfig, TAnalysis> {
  if (!SLUG.test(module.slug)) {
    throw new VerticalRegistryError(`Invalid vertical slug "${module.slug}": must be lowercase, digits and single hyphens`);
  }
  return module;
}
