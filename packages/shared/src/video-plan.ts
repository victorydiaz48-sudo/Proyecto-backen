import { z } from 'zod';

/**
 * VIDEO_PLAN produced by the cinematic reel engine (Phase 7) and stored in
 * VideoPlan.plan. Styles are template data, not an enum, so new styles need
 * no code change.
 */
export const ASPECT_RATIOS = ['9:16', '1:1', '4:5', '16:9'] as const;

export const videoSceneSchema = z.object({
  id: z.string().min(1),
  durationSec: z.number().positive(),
  setting: z.string().min(1), // "premium studio", "urban night", "highway" …
  shot: z.string().min(1), // "low front three-quarter", "wheel close-up" …
  description: z.string().min(1),
  /** Vehicle traits the render must not change. */
  preserve: z.array(z.string()).default([]),
});

export const videoPlanSchema = z
  .object({
    duration: z.number().int().min(3).max(120),
    aspect_ratio: z.enum(ASPECT_RATIOS),
    style: z.string().min(1),
    scenes: z.array(videoSceneSchema).min(1),
    camera_movements: z.array(z.string()),
    transitions: z.array(z.string()),
    text_overlays: z.array(z.object({ atSec: z.number().min(0), text: z.string().min(1) })),
    music_direction: z.string(),
    voiceover: z.string(),
    cta: z.string().min(1),
  })
  .refine((p) => Math.abs(p.scenes.reduce((s, x) => s + x.durationSec, 0) - p.duration) <= 1, {
    message: 'scene durations must add up to the total duration (±1s)',
  });
export type VideoPlan = z.infer<typeof videoPlanSchema>;
