/**
 * Photo-analysis vocabulary generic enough for any vertical whose workflow
 * starts from a single subject photo (dealership today; barbershop,
 * real_estate, etc. can reuse it later — promoted out of the dealership
 * module in Phase 3b per docs/phase-3-design.md §2).
 */

/** What the photo actually shows. Anything but the vertical's expected subject stops the job before any further spend. */
export const PHOTO_SUBJECTS = ['vehicle', 'not_vehicle', 'multiple_vehicles', 'unclear'] as const;
export type PhotoSubject = (typeof PHOTO_SUBJECTS)[number];

/** Problems with the photo itself, so the bot can ask for a better one. */
export const IMAGE_QUALITY_ISSUES = ['blurry', 'dark', 'overexposed', 'partial', 'obstructed', 'low_resolution'] as const;
export type ImageQualityIssue = (typeof IMAGE_QUALITY_ISSUES)[number];
