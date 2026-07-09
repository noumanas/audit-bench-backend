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
exports.ScanRepoDto = void 0;
const class_validator_1 = require("class-validator");
const PROVIDERS = ['anthropic', 'openai', 'gemini'];
const OWNER_REPO_PATTERN = /^[A-Za-z0-9._-]+$/;
const REF_PATTERN = /^[A-Za-z0-9._/-]+$/;
class ScanRepoDto {
    owner;
    repo;
    ref;
    provider;
}
exports.ScanRepoDto = ScanRepoDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(OWNER_REPO_PATTERN, { message: 'owner contains characters not allowed in a GitHub username/org' }),
    __metadata("design:type", String)
], ScanRepoDto.prototype, "owner", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(OWNER_REPO_PATTERN, { message: 'repo contains characters not allowed in a GitHub repository name' }),
    __metadata("design:type", String)
], ScanRepoDto.prototype, "repo", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(REF_PATTERN, { message: 'ref contains characters not allowed in a git branch/tag/SHA' }),
    __metadata("design:type", String)
], ScanRepoDto.prototype, "ref", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsIn)(PROVIDERS),
    __metadata("design:type", String)
], ScanRepoDto.prototype, "provider", void 0);
//# sourceMappingURL=scan-repo.dto.js.map