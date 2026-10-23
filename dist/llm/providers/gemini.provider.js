"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_THINKING_BUDGET = 1024;
const DEFAULT_THINKING_LEVEL = 'low';
const DEFAULT_MODEL = 'gemini-3.8-flash';
let GeminiProvider = class GeminiProvider {
    config;
    name = 'gemini';
    constructor(config) {
        this.config = config;
    }
    async complete(prompt, opts) {
        const apiKey = this.config.get('GEMINI_API_KEY');
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY is not configured on the server');
        }
        const baseModel = this.config.get('GEMINI_MODEL') || DEFAULT_MODEL;
        const model = opts?.escalate ? this.config.get('GEMINI_ESCALATION_MODEL') || baseModel : baseModel;
        const thinkingConfig = this.thinkingConfig(model);
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    maxOutputTokens: MAX_OUTPUT_TOKENS,
                    ...(thinkingConfig ? { thinkingConfig } : {}),
                    ...(opts?.jsonMode ? { responseMimeType: 'application/json' } : {}),
                },
            }),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Gemini API error (${response.status}): ${text}`);
        }
        const data = (await response.json());
        const candidate = data.candidates?.[0];
        const text = (candidate?.content?.parts ?? [])
            .filter((p) => !p.thought)
            .map((p) => p.text ?? '')
            .join('\n');
        if (!text.trim()) {
            const why = data.promptFeedback?.blockReason
                ? `the request was blocked (${data.promptFeedback.blockReason})`
                : candidate?.finishReason === 'MAX_TOKENS'
                    ? 'it ran out of output tokens before answering'
                    : `it returned no text (${candidate?.finishReason ?? 'no candidates'})`;
            throw new Error(`Gemini API error: ${why}`);
        }
        return {
            text,
            usage: {
                inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
                outputTokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0),
            },
        };
    }
    thinkingConfig(model) {
        if (/^gemini-2\.5/.test(model)) {
            const budget = Number(this.config.get('GEMINI_THINKING_BUDGET'));
            const tokens = Number.isFinite(budget) && budget >= 0 ? budget : DEFAULT_THINKING_BUDGET;
            return { thinkingBudget: /pro/.test(model) ? Math.max(tokens, 128) : tokens };
        }
        if (/^gemini-([3-9]|\d{2})/.test(model)) {
            return { thinkingLevel: this.config.get('GEMINI_THINKING_LEVEL') || DEFAULT_THINKING_LEVEL };
        }
        return null;
    }
};
exports.GeminiProvider = GeminiProvider;
exports.GeminiProvider = GeminiProvider = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], GeminiProvider);
//# sourceMappingURL=gemini.provider.js.map