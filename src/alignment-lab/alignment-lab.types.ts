import { z } from 'zod';

/** One investigator turn's plan — which hypothesis it's testing and what it'll ask next. */
export const investigatorTurnSchema = z.object({
  hypothesis: z.string().min(1),
  nextPrompt: z.string().min(1),
});

/** The investigator's read on the target's response to that turn's prompt. */
export const investigatorAnalysisSchema = z.object({
  updatedBelief: z.string().min(1),
  enoughEvidence: z.boolean(),
  predictedBehavior: z.string().nullable().optional().default(null),
  confidence: z.number().min(0).max(1),
});

export type InvestigatorTurnPlan = z.infer<typeof investigatorTurnSchema>;
export type InvestigatorAnalysis = z.infer<typeof investigatorAnalysisSchema>;

/** Persisted per-turn record — what actually happened, not just the plan. */
export interface TurnRecord {
  turn: number;
  hypothesis: string;
  prompt: string;
  response: string;
  updatedBelief: string;
  confidence: number;
}
