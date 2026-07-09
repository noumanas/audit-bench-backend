import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
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
}
