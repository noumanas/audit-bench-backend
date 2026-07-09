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
exports.AnthropicProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const MAX_OUTPUT_TOKENS = 2000;
let AnthropicProvider = class AnthropicProvider {
    config;
    name = 'anthropic';
    constructor(config) {
        this.config = config;
    }
    async complete(prompt, opts) {
        const apiKey = this.config.get('ANTHROPIC_API_KEY');
        if (!apiKey) {
            throw new Error('ANTHROPIC_API_KEY is not configured on the server');
        }
        const baseModel = this.config.get('ANTHROPIC_MODEL') || 'claude-sonnet-4-5';
        const model = opts?.escalate ? this.config.get('ANTHROPIC_ESCALATION_MODEL') || baseModel : baseModel;
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model,
                max_tokens: MAX_OUTPUT_TOKENS,
                messages: [{ role: 'user', content: prompt }],
            }),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Anthropic API error (${response.status}): ${text}`);
        }
        const data = await response.json();
        return (data.content || [])
            .map((block) => (block.type === 'text' ? block.text : ''))
            .filter(Boolean)
            .join('\n');
    }
};
exports.AnthropicProvider = AnthropicProvider;
exports.AnthropicProvider = AnthropicProvider = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], AnthropicProvider);
//# sourceMappingURL=anthropic.provider.js.map