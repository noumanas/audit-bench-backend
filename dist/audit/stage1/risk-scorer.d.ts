import { FunctionRisk, FunctionUnit, LintFinding } from './types';
export declare function selectRiskyFunctions(functions: FunctionUnit[], lint: LintFinding[], filename?: string): FunctionRisk[];
