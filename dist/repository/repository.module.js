"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RepositoryModule = void 0;
const common_1 = require("@nestjs/common");
const repository_service_1 = require("./repository.service");
const repository_controller_1 = require("./repository.controller");
const llm_module_1 = require("../llm/llm.module");
const quota_module_1 = require("../quota/quota.module");
const pipeline_module_1 = require("../audit/pipeline.module");
let RepositoryModule = class RepositoryModule {
};
exports.RepositoryModule = RepositoryModule;
exports.RepositoryModule = RepositoryModule = __decorate([
    (0, common_1.Module)({
        imports: [llm_module_1.LlmModule, quota_module_1.QuotaModule, pipeline_module_1.PipelineModule],
        controllers: [repository_controller_1.RepositoryController],
        providers: [repository_service_1.RepositoryService],
        exports: [repository_service_1.RepositoryService],
    })
], RepositoryModule);
//# sourceMappingURL=repository.module.js.map