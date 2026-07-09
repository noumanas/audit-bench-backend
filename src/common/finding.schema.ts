import { z } from 'zod';

export const findingSchema = z.object({
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  category: z.enum(['Security', 'Logic', 'Performance', 'Architecture', 'Maintainability']),
  title: z.string().min(1),
  line: z.number().int().nullable().optional().default(null),
  description: z.string().min(1),
  rootCause: z.string().min(1),
  suggestedFix: z.string().min(1),
  examplePatch: z.string().nullable().optional().default(null),
  confidence: z.number().min(0).max(1),
});

export const auditResultSchema = z.object({
  verdict: z.enum(['pass', 'needs_work', 'do_not_ship']),
  summary: z.string().min(1),
  findings: z.array(findingSchema).max(15),
});

export type Finding = z.infer<typeof findingSchema>;
