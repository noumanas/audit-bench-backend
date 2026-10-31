import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { OrgRole, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { WelcomeEmailService } from "../email/welcome-email.service";
import { SignupDto } from "./dto/signup.dto";
import { LoginDto } from "./dto/login.dto";
import { ActivityService } from "../activity/activity.service";
import { RequestContext } from "../activity/request-context";
export declare class AuthService {
    private readonly prisma;
    private readonly jwt;
    private readonly config;
    private readonly welcomeEmail;
    private readonly activity;
    constructor(prisma: PrismaService, jwt: JwtService, config: ConfigService, welcomeEmail: WelcomeEmailService, activity: ActivityService);
    signup(dto: SignupDto, ctx: RequestContext): Promise<{
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
    login(dto: LoginDto, ctx: RequestContext): Promise<{
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
    buildSession(user: {
        id: string;
        email: string;
        name: string | null;
        createdAt: Date;
        plan: unknown;
        role: Role;
        isActive: boolean;
        organizationId: string | null;
        orgRole: OrgRole | null;
        organization: {
            id: string;
            name: string;
            slug: string;
        } | null;
    }): {
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
    };
}
