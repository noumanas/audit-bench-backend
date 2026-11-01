import { z } from 'zod';

/**
 * "Logic" covers functional correctness and "Testing" covers test quality:
 * the names stored on every past finding, kept so old reports, analytics
 * and learned suppressions still line up.
 */
export const FINDING_CATEGORIES = [
  'Security',
  'Logic',
  'Performance',
  'Architecture',
  'Maintainability',
  'Testing',
  'Semantic Accuracy',
  'Reliability',
  'Data Integrity',
  'API Design',
  'Concurrency',
  'Resource Management',
] as const;

export const findingSchema = z.object({
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  category: z.enum(FINDING_CATEGORIES),
  title: z.string().min(1),
  line: z.number().int().nullable().optional().default(null),
  // Last line of the problem code when it spans several lines — lets a PR
  // comment cover the whole range. Optional: older cached results lack it.
  endLine: z.number().int().nullable().optional(),
  description: z.string().min(1),
  rootCause: z.string().min(1),
  suggestedFix: z.string().min(1),
  examplePatch: z.string().nullable().optional().default(null),
  // Pull request reviews: the exact new code for lines line..endLine, for a
  // one-click GitHub suggestion. Null unless the fix is confined to those lines.
  replacement: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  // Evidence behind the finding (see focused-prompt RESPONSE_SHAPE). Optional:
  // older cached results and Stage 1 findings don't carry it.
  evidence: z.string().nullable().optional(),
  failureScenario: z.string().nullable().optional(),
  testEvidence: z.string().nullable().optional(),
});

export const auditResultSchema = z.object({
  verdict: z.enum(['pass', 'needs_work', 'do_not_ship']),
  summary: z.string().min(1),
  findings: z.array(findingSchema).max(15),
});

export type Finding = z.infer<typeof findingSchema>;

export const FINDING_STATUSES = ['open', 'in_progress', 'wont_fix'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];
export type FindingStatuses = Record<number, FindingStatus>;
