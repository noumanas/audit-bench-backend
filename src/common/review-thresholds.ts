/**
 * How strict a review is. Teams can tune these (ReviewSettings, edited on
 * the Rules page); anyone who hasn't gets the defaults.
 */
export interface ReviewThresholds {
  /** Findings the model is less sure of than this aren't published. */
  minConfidence: number;
  /** Critical/high findings less certain than this are lowered to medium. */
  severeMinConfidence: number;
  /** Stage 1: nesting this deep earns a complexity finding (and an AI look). */
  deepNesting: number;
  /** Stage 1: this many paths through a function earns one even when flat. */
  veryHighComplexity: number;
  /** PR reviews: list optional ("info") suggestions in the summary. */
  optionalSuggestions: boolean;
}

export const DEFAULT_THRESHOLDS: ReviewThresholds = {
  minConfidence: 0.4,
  severeMinConfidence: 0.6,
  deepNesting: 4,
  veryHighComplexity: 25,
  optionalSuggestions: true,
};

/** Allowed ranges, enforced on save (see ReviewSettingsDto). */
export const THRESHOLD_LIMITS = {
  minConfidence: { min: 0.2, max: 0.8 },
  severeMinConfidence: { min: 0.4, max: 0.95 },
  deepNesting: { min: 2, max: 8 },
  veryHighComplexity: { min: 12, max: 60 },
} as const;

export function isDefaultThresholds(t: ReviewThresholds): boolean {
  return (Object.keys(DEFAULT_THRESHOLDS) as (keyof ReviewThresholds)[]).every((k) => t[k] === DEFAULT_THRESHOLDS[k]);
}
