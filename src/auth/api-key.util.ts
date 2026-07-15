import * as crypto from 'crypto';

// Distinct from a JWT (which always starts "eyJ...") so JwtAuthGuard can
// tell the two apart without attempting (and failing) to verify an API key
// as a JWT signature.
export const API_KEY_PREFIX = 'abk_';

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
}
