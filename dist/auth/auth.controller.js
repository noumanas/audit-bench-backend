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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const auth_service_1 = require("./auth.service");
const signup_dto_1 = require("./dto/signup.dto");
const login_dto_1 = require("./dto/login.dto");
const password_reset_dto_1 = require("./dto/password-reset.dto");
const password_reset_service_1 = require("./password-reset.service");
const activity_service_1 = require("../activity/activity.service");
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const SIGNUP_THROTTLE = { default: { limit: 5, ttl: 60 * 60_000 } };
const RESET_REQUEST_THROTTLE = { default: { limit: 5, ttl: 60 * 60_000 } };
const RESET_VERIFY_THROTTLE = { default: { limit: 10, ttl: 10 * 60_000 } };
let AuthController = class AuthController {
    authService;
    passwordReset;
    activity;
    constructor(authService, passwordReset, activity) {
        this.authService = authService;
        this.passwordReset = passwordReset;
        this.activity = activity;
    }
    signup(dto, req) {
        return this.authService.signup(dto, this.activity.context(req));
    }
    login(dto, req) {
        return this.authService.login(dto, this.activity.context(req));
    }
    forgotPassword(dto) {
        return this.passwordReset.requestCode(dto.email);
    }
    verifyResetCode(dto) {
        return this.passwordReset.verifyCode(dto.email, dto.code);
    }
    resetPassword(dto, req) {
        return this.passwordReset.resetPassword(dto.email, dto.resetToken, dto.password, this.activity.context(req));
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, throttler_1.Throttle)(SIGNUP_THROTTLE),
    (0, common_1.Post)('signup'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [signup_dto_1.SignupDto, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "signup", null);
__decorate([
    (0, throttler_1.Throttle)(AUTH_THROTTLE),
    (0, common_1.Post)('login'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [login_dto_1.LoginDto, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "login", null);
__decorate([
    (0, throttler_1.Throttle)(RESET_REQUEST_THROTTLE),
    (0, common_1.Post)('forgot-password'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [password_reset_dto_1.ForgotPasswordDto]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "forgotPassword", null);
__decorate([
    (0, throttler_1.Throttle)(RESET_VERIFY_THROTTLE),
    (0, common_1.Post)('forgot-password/verify'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [password_reset_dto_1.VerifyResetCodeDto]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "verifyResetCode", null);
__decorate([
    (0, throttler_1.Throttle)(AUTH_THROTTLE),
    (0, common_1.Post)('reset-password'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [password_reset_dto_1.ResetPasswordDto, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "resetPassword", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)('auth'),
    __metadata("design:paramtypes", [auth_service_1.AuthService,
        password_reset_service_1.PasswordResetService,
        activity_service_1.ActivityService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map