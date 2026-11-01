import { Finding } from '../../common/types';
import { FunctionUnit, Stage1Result } from './types';
import { ReviewThresholds } from '../../common/review-thresholds';
export declare function complexityFinding(fn: FunctionUnit, t?: ReviewThresholds): Finding | null;
export declare function stage1ToFindings(stage1: Stage1Result, thresholds?: ReviewThresholds): Finding[];
