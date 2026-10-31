import type { Request } from 'express';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ActivityService } from '../activity/activity.service';
export declare class AuthController {
    private readonly authService;
    private readonly activity;
    constructor(authService: AuthService, activity: ActivityService);
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
}
