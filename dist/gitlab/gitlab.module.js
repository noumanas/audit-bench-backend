"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitlabModule = void 0;
const common_1 = require("@nestjs/common");
const gitlab_service_1 = require("./gitlab.service");
const gitlab_controller_1 = require("./gitlab.controller");
const repository_module_1 = require("../repository/repository.module");
let GitlabModule = class GitlabModule {
};
exports.GitlabModule = GitlabModule;
exports.GitlabModule = GitlabModule = __decorate([
    (0, common_1.Module)({
        imports: [repository_module_1.RepositoryModule],
        controllers: [gitlab_controller_1.GitlabController],
        providers: [gitlab_service_1.GitlabService],
    })
], GitlabModule);
//# sourceMappingURL=gitlab.module.js.map