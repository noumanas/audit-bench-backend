import { ScannedFile } from './types';
import { SkippedFile } from './generated-files';
export declare function extractZip(buffer: Buffer, maxFileSizeBytes: number, skipped?: SkippedFile[]): ScannedFile[];
