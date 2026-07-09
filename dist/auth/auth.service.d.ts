import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
export declare class AuthService {
    private readonly prisma;
    private readonly jwt;
    constructor(prisma: PrismaService, jwt: JwtService);
    signup(dto: SignupDto): Promise<{
        accessToken: string;
        user: {
            id: string;
            email: string;
            name: string | null;
            createdAt: Date;
            plan: unknown;
        };
    }>;
    login(dto: LoginDto): Promise<{
        accessToken: string;
        user: {
            id: string;
            email: string;
            name: string | null;
            createdAt: Date;
            plan: unknown;
        };
    }>;
    private buildSession;
}
