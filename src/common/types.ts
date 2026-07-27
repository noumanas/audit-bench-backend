export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type Verdict = 'pass' | 'needs_work' | 'do_not_ship';

export type FindingCategory =
  | 'Security'
  | 'Logic'
  | 'Performance'
  | 'Architecture'
  | 'Maintainability'
  | 'Testing';

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

export type LlmProviderName =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'deepseek'
  | 'glm'
  | 'qwen'
  | 'kimi'
  | 'xai'
  | 'mistral'
  | 'minimax';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens };
}
