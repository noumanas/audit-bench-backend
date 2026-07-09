export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type Verdict = 'pass' | 'needs_work' | 'do_not_ship';

export type FindingCategory =
  | 'Security'
  | 'Logic'
  | 'Performance'
  | 'Architecture'
  | 'Maintainability';

export interface Finding {
  severity: Severity;
  category: FindingCategory;
  title: string;
  line: number | null;
  description: string;
  rootCause: string;
  suggestedFix: string;
  examplePatch: string | null;
  confidence: number; // 0-1
}

export interface AuditResult {
  verdict: Verdict;
  summary: string;
  findings: Finding[];
}

export type LlmProviderName = 'anthropic' | 'openai' | 'gemini';
