import { FunctionRisk, FunctionUnit, LintFinding } from './types';
import { ReviewThresholds } from '../../common/review-thresholds';
export declare function selectRiskyFunctions(functions: FunctionUnit[], lint: LintFinding[], filename?: string, thresholds?: ReviewThresholds): FunctionRisk[];
