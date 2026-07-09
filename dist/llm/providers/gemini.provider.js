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
const MAX_OUTPUT_TOKENS = 2000;
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
        const baseModel = this.config.get('GEMINI_MODEL') || 'gemini-2.5-pro';
        const model = opts?.escalate ? this.config.get('GEMINI_ESCALATION_MODEL') || baseModel : baseModel;
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    maxOutputTokens: MAX_OUTPUT_TOKENS,
                    responseMimeType: 'application/json',
                },
            }),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Gemini API error (${response.status}): ${text}`);
        }
        const data = await response.json();
        return (data.candidates?.[0]?.content?.parts
            ?.map((p) => p.text ?? '')
            .join('\n') ?? '');
    }
};
exports.GeminiProvider = GeminiProvider;
exports.GeminiProvider = GeminiProvider = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], GeminiProvider);
//# sourceMappingURL=gemini.provider.js.map