import { ScannedFile } from './types';
export interface DependencyVulnerability {
    package: string;
    severity: string;
    title: string;
    url: string;
    range: string;
}
export declare function auditDependencies(files: ScannedFile[]): Promise<DependencyVulnerability[]>;
