import { Stage1Result } from './types';
export declare function runSemgrep(code: string, filename: string): Promise<Stage1Result['semgrep']>;
