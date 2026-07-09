import { FunctionRisk, FunctionUnit } from '../stage1/types';
export interface FocusedPromptOptions {
    filename: string;
    language?: string;
    riskyFunctions: FunctionRisk[];
    allFunctions: FunctionUnit[];
    repoContext?: string;
    focusAreas?: string[];
}
export declare function buildFocusedPrompt(opts: FocusedPromptOptions): string;
