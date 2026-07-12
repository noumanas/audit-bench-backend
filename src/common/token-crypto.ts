import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

// Same "fail loudly at boot" reasoning as JWT_SECRET (see jwt-secret.ts) — a
// hardcoded fallback would mean every deployment that forgets to set this
// shares the same encryption key for every user's GitHub/GitLab tokens.
const KNOWN_PLACEHOLDERS = new Set(['changeme', 'dev-secret-change-me', '']);

export function requireEncryptionKey(config: ConfigService): Buffer {
  const key = config.get<string>('TOKEN_ENCRYPTION_KEY');
  if (!key || KNOWN_PLACEHOLDERS.has(key)) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is not set to a real value. Generate one with: ' +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  const buf = Buffer.from(key, 'base64');
  if (buf.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes.');
  }
  return buf;
}

/** Format: enc:v1:<iv>:<authTag>:<ciphertext>, all base64 — versioned so the scheme can change later without breaking old rows mid-migration. */
export function encryptToken(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * Values written before this encryption layer existed are plain strings
 * with no `enc:v1:` prefix — returned as-is so existing connections keep
 * working. They get encrypted the next time they're written (reconnect,
 * OAuth login/refresh), so the DB self-migrates over time with no
 * separate backfill script needed.
 */
export function decryptToken(stored: string, key: Buffer): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const [ivB64, authTagB64, ciphertextB64] = stored.slice(PREFIX.length).split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
