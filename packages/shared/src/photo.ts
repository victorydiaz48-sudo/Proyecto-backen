/**
 * Photo-analysis vocabulary generic enough for any vertical whose workflow
 * starts from a single subject photo.
 *
 * PHOTO_SUBJECTS was promoted here in Phase 3b on the theory that "what the
 * photo shows" would be shape-reusable across verticals — scaffolding a
 * second vertical in Phase 3d proved that wrong: the *values* are domain
 * content ('vehicle', 'not_vehicle', …), not generic shape, so each module
 * now defines its own subject enum (dealership's is in
 * packages/verticals/dealership/src/entities/vehicle-analysis.ts). Kept as a
 * documented correction rather than a silent revert.
 */

/** Problems with the photo itself, so the bot can ask for a better one — genuinely generic (no domain content in the values). */
export const IMAGE_QUALITY_ISSUES = ['blurry', 'dark', 'overexposed', 'partial', 'obstructed', 'low_resolution'] as const;
export type ImageQualityIssue = (typeof IMAGE_QUALITY_ISSUES)[number];
