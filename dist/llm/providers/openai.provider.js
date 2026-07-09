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
exports.OpenAiProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const MAX_OUTPUT_TOKENS = 6000;
let OpenAiProvider = class OpenAiProvider {
    config;
    name = 'openai';
    constructor(config) {
        this.config = config;
    }
    async complete(prompt, opts) {
        const apiKey = this.config.get('OPENAI_API_KEY');
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY is not configured on the server');
        }
        const baseModel = this.config.get('OPENAI_MODEL') || 'gpt-5-mini';
        const model = opts?.escalate ? this.config.get('OPENAI_ESCALATION_MODEL') || baseModel : baseModel;
        let response = await this.request(apiKey, model, prompt, true);
        if (!response.ok && response.status === 400) {
            const body = await response.clone().text();
            if (body.includes('reasoning_effort')) {
                response = await this.request(apiKey, model, prompt, false);
            }
        }
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`OpenAI API error (${response.status}): ${text}`);
        }
        const data = await response.json();
        const choice = data.choices?.[0];
        if (choice?.finish_reason === 'length') {
            throw new Error('OpenAI response was truncated before completing (hit the output token limit) — the model spent its budget on internal reasoning for this prompt');
        }
        return choice?.message?.content ?? '';
    }
    request(apiKey, model, prompt, withReasoningEffort) {
        return fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                max_completion_tokens: MAX_OUTPUT_TOKENS,
                response_format: { type: 'json_object' },
                ...(withReasoningEffort ? { reasoning_effort: 'low' } : {}),
            }),
        });
    }
};
exports.OpenAiProvider = OpenAiProvider;
exports.OpenAiProvider = OpenAiProvider = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], OpenAiProvider);
//# sourceMappingURL=openai.provider.js.map