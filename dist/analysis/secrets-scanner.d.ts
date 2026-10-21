import { ScannedFile, SecretFinding } from './types';
export declare function scanSecrets(files: ScannedFile[]): SecretFinding[];
export declare function maskSecret(line: string, secret: string): string;
