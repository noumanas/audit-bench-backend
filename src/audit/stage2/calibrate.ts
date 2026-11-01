import { Finding, Severity } from '../../common/types';
import { findingFingerprint } from '../../common/finding-fingerprint';
import { DEFAULT_THRESHOLDS, ReviewThresholds } from '../../common/review-thresholds';

// Code-health findings can be right and still not be a reason to stop a
// merge: they're capped at medium however sure the model is.
const NON_BLOCKING: ReadonlySet<string> = new Set(['Maintainability', 'Architecture']);

export interface CalibrationReport {
  /** Dropped for confidence below the team's minConfidence. */
  unsupported: number;
  /** Severity lowered by one of the caps. */
  downgraded: number;
  /** Merged into an earlier finding on the same lines. */
  duplicates: number;
}

export interface Calibrated {
  findings: Finding[];
  report: CalibrationReport;
}

const lower = (a: Severity, b: Severity): Severity => {
  const rank: Record<Severity, number> = { info: -1, low: 0, medium: 1, high: 2, critical: 3 };
  return rank[a] <= rank[b] ? a : b;
};

/**
 * Keeps severity (impact if real) and confidence (how sure it is real)
 * independent after the model has answered:
 * - a finding the model gives under `minConfidence` is withheld rather
 *   than presented as a defect;
 * - a critical/high finding under `severeMinConfidence` becomes medium, so
 *   an unconfirmed concern can't block a merge on its own;
 * - maintainability and architecture findings stop at medium;
 * - two findings of the same kind on overlapping lines are merged, keeping
 *   the more confident one.
 * Deterministic, so the same model output always publishes the same way.
 */
export function calibrateFindings(findings: Finding[], t: ReviewThresholds = DEFAULT_THRESHOLDS): Calibrated {
  const report: CalibrationReport = { unsupported: 0, downgraded: 0, duplicates: 0 };
  const kept: Finding[] = [];

  for (const original of findings) {
    if (original.confidence < t.minConfidence) {
      report.unsupported++;
      continue;
    }
    let severity = original.severity;
    if ((severity === 'critical' || severity === 'high') && original.confidence < t.severeMinConfidence) {
      severity = 'medium';
    }
    if (NON_BLOCKING.has(original.category)) severity = lower(severity, 'medium');
    if (severity !== original.severity) report.downgraded++;
    const finding = severity === original.severity ? original : { ...original, severity };

    const fp = findingFingerprint(finding);
    const span = (f: Finding) => [f.line ?? 0, f.endLine ?? f.line ?? 0] as const;
    const [start, end] = span(finding);
    const twin = kept.findIndex((k) => {
      if (findingFingerprint(k) !== fp) return false;
      const [ks, ke] = span(k);
      return start <= ke && ks <= end;
    });
    if (twin >= 0) {
      report.duplicates++;
      if (finding.confidence > kept[twin].confidence) kept[twin] = finding;
      continue;
    }
    kept.push(finding);
  }

  return { findings: kept, report };
}
