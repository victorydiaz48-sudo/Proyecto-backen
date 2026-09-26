import { z } from 'zod';

/** Result of automated content QA (Phase 8). Stored on ContentAsset.qaReport. */
export const qaIssueSchema = z.object({
  code: z.string().min(1), // e.g. "HALLUCINATED_SPEC", "PRICE_MISMATCH", "BAD_DIMENSIONS"
  message: z.string().min(1),
  field: z.string().optional(),
});

export const qaReportSchema = z.object({
  approved: z.boolean(),
  errors: z.array(qaIssueSchema),
  warnings: z.array(qaIssueSchema),
  confidence: z.number().min(0).max(1),
  checkedAt: z.iso.datetime().optional(),
  checker: z.string().optional(),
});
export type QaReport = z.infer<typeof qaReportSchema>;
