export interface FunctionUnit {
    name: string;
    startLine: number;
    endLine: number;
    code: string;
    complexity: number;
    callsInFile: string[];
}
export interface LintFinding {
    line: number;
    ruleId: string | null;
    message: string;
    severity: 'warning' | 'error';
}
export interface TsDiagnostic {
    line: number;
    message: string;
}
export interface RiskySignal {
    pattern: string;
    line: number;
    snippet: string;
}
export interface FunctionRisk {
    fn: FunctionUnit;
    score: number;
    reasons: string[];
}
export interface Stage1Result {
    lint: LintFinding[];
    tsDiagnostics: TsDiagnostic[];
    formatted: boolean;
    formattingSkipped: boolean;
    semgrep: {
        skipped: true;
        reason: string;
    } | {
        skipped: false;
        findings: RiskySignal[];
    };
    functions: FunctionUnit[];
    riskyFunctions: FunctionRisk[];
    clean: boolean;
}
