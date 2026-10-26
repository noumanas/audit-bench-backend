import { worstVerdict } from '../common/verdict';
import { Verdict } from '../common/types';
import { RiskAggregation } from './risk-aggregation';

/**
 * The scan's verdict, raised to match what the rest of the report says:
 * exposed secrets mean "do not ship", and high-risk vulnerable dependencies
 * or a high overall risk rating can't read as a pass. Returns why it was
 * raised, for the summary.
 */
export function reconcileVerdict(
  fileVerdict: Verdict,
  ctx: { uniqueSecrets: number; risk: RiskAggregation | null },
): { verdict: Verdict; reasons: string[] } {
  let verdict = fileVerdict;
  const reasons: string[] = [];
  const raise = (to: Verdict, why: string) => {
    const next = worstVerdict([verdict, to]);
    if (next !== verdict) reasons.push(why);
    verdict = next;
  };
  if (ctx.uniqueSecrets > 0) raise('do_not_ship', `${ctx.uniqueSecrets} exposed secret(s) to rotate`);
  const dependencies = ctx.risk?.categories.find((c) => c.category === 'Dependency risk');
  if (dependencies?.riskLevel === 'high') raise('needs_work', 'high-risk vulnerable dependencies');
  if (ctx.risk?.overallRiskRating === 'high') raise('needs_work', `overall risk rated HIGH (health ${ctx.risk.overallHealthScore}/100)`);
  return { verdict, reasons };
}
