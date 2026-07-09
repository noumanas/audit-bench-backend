import { ConfigService } from '@nestjs/config';

// Anyone who knows this secret can forge a valid JWT for any user ID — a
// hardcoded fallback here would mean every deployment that forgets to set
// JWT_SECRET shares the same signing key. Fail loudly at boot instead.
const KNOWN_PLACEHOLDERS = new Set(['changeme', 'dev-secret-change-me', '']);

export function requireJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (!secret || KNOWN_PLACEHOLDERS.has(secret)) {
    throw new Error(
      'JWT_SECRET is not set to a real value. Generate one with: ' +
        `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return secret;
}
