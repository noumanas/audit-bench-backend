import { FunctionRisk, FunctionUnit } from '../stage1/types';
export interface FocusedPromptOptions {
    filename: string;
    language?: string;
    riskyFunctions: FunctionRisk[];
    allFunctions: FunctionUnit[];
    repoContext?: string;
    focusAreas?: string[];
    teamRules?: string;
}
export declare function buildFocusedPrompt(opts: FocusedPromptOptions): string;
export interface DiffPromptOptions {
    filename: string;
    language?: string;
    code: string;
    changedRanges: Array<{
        start: number;
        end: number;
    }>;
    relatedContext?: string;
    repoContext?: string;
    focusAreas?: string[];
    teamRules?: string;
}
export declare function buildDiffPrompt(opts: DiffPromptOptions): string;
