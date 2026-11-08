import type { Request } from 'express';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto, ResetPasswordDto, VerifyResetCodeDto } from './dto/password-reset.dto';
import { PasswordResetService } from './password-reset.service';
import { ActivityService } from '../activity/activity.service';
export declare class AuthController {
    private readonly authService;
    private readonly passwordReset;
    private readonly activity;
    constructor(authService: AuthService, passwordReset: PasswordResetService, activity: ActivityService);
    signup(dto: SignupDto, req: Request): Promise<{
        accessToken: string;
        user: {
            id: string;
            email: string;
            name: string | null;
            createdAt: Date;
            plan: unknown;
            role: import(".prisma/client").$Enums.Role;
            organization: {
                id: string;
                name: string;
                slug: string;
            } | null;
            orgRole: import(".prisma/client").$Enums.OrgRole | null;
        };
    }>;
    login(dto: LoginDto, req: Request): Promise<{
        accessToken: string;
        user: {
            id: string;
            email: string;
            name: string | null;
            createdAt: Date;
            plan: unknown;
            role: import(".prisma/client").$Enums.Role;
            organization: {
                id: string;
                name: string;
                slug: string;
            } | null;
            orgRole: import(".prisma/client").$Enums.OrgRole | null;
        };
    }>;
    forgotPassword(dto: ForgotPasswordDto): Promise<{
        ok: true;
    }>;
    verifyResetCode(dto: VerifyResetCodeDto): Promise<{
        resetToken: string;
    }>;
    resetPassword(dto: ResetPasswordDto, req: Request): Promise<{
        accessToken: string;
        user: {
            id: string;
            email: string;
            name: string | null;
            createdAt: Date;
            plan: unknown;
            role: import(".prisma/client").$Enums.Role;
            organization: {
                id: string;
                name: string;
                slug: string;
            } | null;
            orgRole: import(".prisma/client").$Enums.OrgRole | null;
        };
    }>;
}
