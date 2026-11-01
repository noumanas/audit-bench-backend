/** "info": an optional suggestion. Only PR reviews produce it, listed apart from the findings (see PipelineService). */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type Verdict = 'pass' | 'needs_work' | 'do_not_ship';

export type FindingCategory =
  | 'Security'
  | 'Logic'
  | 'Performance'
  | 'Architecture'
  | 'Maintainability'
  | 'Testing'
  | 'Semantic Accuracy'
  | 'Reliability'
  | 'Data Integrity'
  | 'API Design'
  | 'Concurrency'
  | 'Resource Management';

export interface Finding {
  severity: Severity;
  category: FindingCategory;
  title: string;
  line: number | null;
  /** Last line of the problem code when it spans several lines; null or absent for a single line. */
  endLine?: number | null;
  description: string;
  rootCause: string;
  suggestedFix: string;
  examplePatch: string | null;
  /** PR reviews: exact new code for lines line..endLine, offered as a one-click GitHub suggestion. */
  replacement?: string | null;
  confidence: number; // 0-1
  /** The code that shows the problem, with line numbers. Absent on results from before it existed. */
  evidence?: string | null;
  /** Concrete input or state, and the wrong result it produces. */
  failureScenario?: string | null;
  /** What the tests shown to the reviewer say about this case, or null when none were shown. */
  testEvidence?: string | null;
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
