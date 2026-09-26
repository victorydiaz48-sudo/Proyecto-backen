import { VerticalRegistryError } from './errors.js';
import type { VerticalModule } from './module.js';

/**
 * Holds the set of modules compiled into this build (no runtime plugin
 * loading — apps/server's `verticals.generated.ts` lists which module
 * packages are linked in; see docs/phase-3-design.md §6.2). Validates at
 * construction time that modules don't collide with each other, so a broken
 * combination fails at startup, not mid-request.
 *
 * Dispatch is always a `Map` lookup by slug — never an `if`/`switch` keyed on
 * a vertical name (docs/phase-3-design.md §6.3).
 *
 * Phase 3a's construction-time check also rejected message-key collisions
 * across modules' `messages` fragments. Scaffolding a real second vertical
 * in Phase 3d proved that check wrong: a fragment is only ever looked up by
 * its *own* module's code (`dealershipMessages(locale)`,
 * `barbershopMessages(locale)`, …) — nothing merges fragments from different
 * modules into one namespace, so two modules both having a top-level
 * `labels` key (an entirely reasonable, unremarkable thing for unrelated
 * modules to both want) can never actually collide at runtime. Removed as a
 * documented correction rather than worked around per-module.
 */
export class VerticalRegistry {
  private readonly bySlug = new Map<string, VerticalModule>();

  constructor(modules: readonly VerticalModule[]) {
    for (const m of modules) {
      if (this.bySlug.has(m.slug)) {
        throw new VerticalRegistryError(`Duplicate vertical slug "${m.slug}"`);
      }
      this.bySlug.set(m.slug, m);
    }
  }

  has(slug: string): boolean {
    return this.bySlug.has(slug);
  }

  /** Throws VerticalRegistryError for an unregistered slug — never returns undefined. */
  get(slug: string): VerticalModule {
    const m = this.bySlug.get(slug);
    if (!m) throw new VerticalRegistryError(`Unknown vertical "${slug}"`);
    return m;
  }

  list(): VerticalModule[] {
    return [...this.bySlug.values()];
  }

  /**
   * Parses a namespaced subjectType ("dealership.vehicle") and resolves the
   * owning module. The only place a namespaced string is parsed — every
   * other caller works with the resolved VerticalModule.
   */
  resolveSubjectType(subjectType: string): { module: VerticalModule; entityKind: string } {
    const i = subjectType.indexOf('.');
    if (i <= 0) throw new VerticalRegistryError(`Malformed subjectType "${subjectType}" (expected "<vertical>.<entity>")`);
    const slug = subjectType.slice(0, i);
    return { module: this.get(slug), entityKind: subjectType.slice(i + 1) };
  }
}
