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
exports.LlmService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const anthropic_provider_1 = require("./providers/anthropic.provider");
const openai_provider_1 = require("./providers/openai.provider");
const gemini_provider_1 = require("./providers/gemini.provider");
function extractJson(raw) {
    const withoutFences = raw.replace(/```json|```/gi, '').trim();
    const start = withoutFences.indexOf('{');
    const end = withoutFences.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start)
        return withoutFences;
    return withoutFences.slice(start, end + 1);
}
let LlmService = class LlmService {
    config;
    providers;
    constructor(config, anthropic, openai, gemini) {
        this.config = config;
        this.providers = { anthropic, openai, gemini };
    }
    resolveProvider(requested) {
        const fallback = (this.config.get('DEFAULT_LLM_PROVIDER') || 'anthropic');
        if (requested && requested in this.providers)
            return requested;
        return fallback;
    }
    hasEscalationModel(providerName) {
        return Boolean(this.config.get(`${providerName.toUpperCase()}_ESCALATION_MODEL`));
    }
    async completeText(providerName, prompt) {
        return this.providers[providerName].complete(prompt);
    }
    async completeStructured(providerName, prompt, schema, opts) {
        const provider = this.providers[providerName];
        const attempt = async (p) => {
            const raw = await provider.complete(p, opts);
            const json = JSON.parse(extractJson(raw));
            return schema.parse(json);
        };
        try {
            return await attempt(prompt);
        }
        catch {
            const repairPrompt = `${prompt}\n\nYour previous response could not be parsed. Return ONLY a single valid JSON object matching the required shape — no markdown fences, no commentary, no trailing text.`;
            return attempt(repairPrompt);
        }
    }
};
exports.LlmService = LlmService;
exports.LlmService = LlmService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        anthropic_provider_1.AnthropicProvider,
        openai_provider_1.OpenAiProvider,
        gemini_provider_1.GeminiProvider])
], LlmService);
//# sourceMappingURL=llm.service.js.map