"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditResultSchema = exports.findingSchema = void 0;
const zod_1 = require("zod");
exports.findingSchema = zod_1.z.object({
    severity: zod_1.z.enum(['critical', 'high', 'medium', 'low']),
    category: zod_1.z.enum(['Security', 'Logic', 'Performance', 'Architecture', 'Maintainability']),
    title: zod_1.z.string().min(1),
    line: zod_1.z.number().int().nullable().optional().default(null),
    description: zod_1.z.string().min(1),
    rootCause: zod_1.z.string().min(1),
    suggestedFix: zod_1.z.string().min(1),
    examplePatch: zod_1.z.string().nullable().optional().default(null),
    confidence: zod_1.z.number().min(0).max(1),
});
exports.auditResultSchema = zod_1.z.object({
    verdict: zod_1.z.enum(['pass', 'needs_work', 'do_not_ship']),
    summary: zod_1.z.string().min(1),
    findings: zod_1.z.array(exports.findingSchema).max(15),
});
//# sourceMappingURL=finding.schema.js.map