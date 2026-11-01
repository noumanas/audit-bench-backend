import { Stage1Result } from './types';
import { ReviewThresholds } from '../../common/review-thresholds';
export declare function runStage1(code: string, filename: string, thresholds?: ReviewThresholds): Promise<Stage1Result>;
