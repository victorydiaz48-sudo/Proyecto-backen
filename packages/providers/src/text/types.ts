import type { Locale } from '@autocontent/shared';
import type { z } from 'zod';
import type { TestableProvider } from '../status.js';
import type { ProviderCallOptions, ProviderResult } from '../types.js';

/** A prompt resolved from the versioned prompt registry (packages/ai). */
export interface ResolvedPrompt {
  /** e.g. "copy.instagram-caption" */
  id: string;
  /** e.g. "v1" — logged in GenerationLog.promptVersion */
  version: string;
  system: string;
  user: string;
  /** Images the model may look at (e.g. the original vehicle photo). */
  images?: { bytes: Uint8Array; mime: string }[];
}

export interface TextGenerationOptions extends ProviderCallOptions {
  locale: Locale;
  maxOutputTokens?: number;
  /** 0 = deterministic. Copywriting uses low values; never above 1. */
  temperature?: number;
}

/**
 * LLM used by the copywriting, strategy and QA engines. Output is always
 * structured: the adapter must return data that passes `schema`, or throw
 * ProviderResponseError (the caller re-prompts once with the validation error).
 */
export interface TextGenerationProvider extends TestableProvider {
  readonly kind: 'TEXT_GENERATION';
  generateStructured<T>(
    prompt: ResolvedPrompt,
    schema: z.ZodType<T>,
    opts: TextGenerationOptions,
  ): Promise<ProviderResult<T>>;
}
