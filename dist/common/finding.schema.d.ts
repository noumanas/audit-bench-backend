import { z } from 'zod';
export declare const findingSchema: z.ZodObject<{
    severity: z.ZodEnum<{
        critical: "critical";
        high: "high";
        medium: "medium";
        low: "low";
    }>;
    category: z.ZodEnum<{
        Security: "Security";
        Logic: "Logic";
        Performance: "Performance";
        Architecture: "Architecture";
        Maintainability: "Maintainability";
        Testing: "Testing";
    }>;
    title: z.ZodString;
    line: z.ZodDefault<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
    description: z.ZodString;
    rootCause: z.ZodString;
    suggestedFix: z.ZodString;
    examplePatch: z.ZodDefault<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    confidence: z.ZodNumber;
}, z.core.$strip>;
export declare const auditResultSchema: z.ZodObject<{
    verdict: z.ZodEnum<{
        pass: "pass";
        needs_work: "needs_work";
        do_not_ship: "do_not_ship";
    }>;
    summary: z.ZodString;
    findings: z.ZodArray<z.ZodObject<{
        severity: z.ZodEnum<{
            critical: "critical";
            high: "high";
            medium: "medium";
            low: "low";
        }>;
        category: z.ZodEnum<{
            Security: "Security";
            Logic: "Logic";
            Performance: "Performance";
            Architecture: "Architecture";
            Maintainability: "Maintainability";
            Testing: "Testing";
        }>;
        title: z.ZodString;
        line: z.ZodDefault<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        description: z.ZodString;
        rootCause: z.ZodString;
        suggestedFix: z.ZodString;
        examplePatch: z.ZodDefault<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
        confidence: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Finding = z.infer<typeof findingSchema>;
export declare const FINDING_STATUSES: readonly ["open", "in_progress", "wont_fix"];
export type FindingStatus = (typeof FINDING_STATUSES)[number];
export type FindingStatuses = Record<number, FindingStatus>;
