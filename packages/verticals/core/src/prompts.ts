import type { Locale } from '@autocontent/shared';
import type { ResolvedPrompt } from '@autocontent/providers';

/**
 * How a module supplies its AI prompts. Thin on purpose — Phase 5 (LLM
 * copywriting) owns fleshing this out; Phase 3 only reserves the shape so a
 * module can declare where its prompts will eventually live.
 */
export interface PromptProvider {
  resolve(promptId: string, locale: Locale): ResolvedPrompt;
}
