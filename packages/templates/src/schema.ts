import { ASPECT_RATIOS, LOCALES } from '@autocontent/shared';
import { z } from 'zod';

/** Marketing scenes the image engine can place the real vehicle into. */
export const IMAGE_SCENES = ['premium-studio', 'urban-night', 'highway', 'showroom', 'cinematic-road'] as const;

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const formatId = z.string().regex(/^[a-z0-9_]+$/);
const localized = z.object({ es: z.array(z.string().min(1)).min(1), pt: z.array(z.string().min(1)).min(1), en: z.array(z.string().min(1)).min(1) });

export const formatSchema = z.object({
  id: formatId,
  kind: z.enum(['TEXT', 'IMAGE', 'VIDEO']),
  channel: z.enum(['INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'YOUTUBE', 'WHATSAPP', 'MARKETPLACE', 'WEBSITE', 'GENERIC']),
  maxChars: z.number().int().positive().optional(),
  aspectRatio: z.enum(ASPECT_RATIOS).optional(),
  durationSec: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }).optional(),
  slides: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }).optional(),
});
export type ContentFormat = z.infer<typeof formatSchema>;

export const videoStyleSchema = z.object({
  id: slug,
  name: z.string().min(1),
  pacing: z.string().min(1),
  cameraMovements: z.array(z.string()).min(1),
  transitions: z.array(z.string()).min(1),
  music: z.string().min(1),
  colorGrade: z.string().min(1),
});
export type VideoStyle = z.infer<typeof videoStyleSchema>;

/**
 * A content template: metadata, prompt guidance, copy strategy, scene
 * structure, CTA strategy and format config. Pure data — engines read it,
 * business logic never hardcodes it.
 */
export const templateSchema = z.object({
  slug,
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  locales: z.array(z.enum(LOCALES)).min(1),
  tone: z.object({
    voice: z.string().min(1),
    adjectives: z.array(z.string()).min(1),
    /** Things the copy must never do (fed to generation and QA). */
    avoid: z.array(z.string()).min(1),
  }),
  prompt: z.object({ copyGuidance: z.string().min(1), imageGuidance: z.string().min(1) }),
  copyStrategy: z.object({
    hookStyle: z.string().min(1),
    structure: z.array(z.string()).min(1),
    emojiPolicy: z.enum(['none', 'light', 'rich']),
    hashtags: z.object({ min: z.number().int().min(0), max: z.number().int().max(30) }),
  }),
  sceneStructure: z
    .array(z.object({ id: slug, setting: z.string().min(1), shot: z.string().min(1), purpose: z.string().min(1) }))
    .min(2),
  ctaStrategy: z.object({
    primary: z.enum(['message', 'call', 'visit', 'whatsapp']),
    urgency: z.enum(['low', 'medium', 'high']),
    examples: localized,
  }),
  formats: z.array(formatId).min(1),
  videoStyles: z.array(slug),
  imageScenes: z.array(z.enum(IMAGE_SCENES)).min(1),
});
export type ContentTemplate = z.infer<typeof templateSchema>;
