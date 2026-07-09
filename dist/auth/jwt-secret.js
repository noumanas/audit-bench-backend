"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireJwtSecret = requireJwtSecret;
const KNOWN_PLACEHOLDERS = new Set(['changeme', 'dev-secret-change-me', '']);
function requireJwtSecret(config) {
    const secret = config.get('JWT_SECRET');
    if (!secret || KNOWN_PLACEHOLDERS.has(secret)) {
        throw new Error('JWT_SECRET is not set to a real value. Generate one with: ' +
            `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
    }
    return secret;
}
//# sourceMappingURL=jwt-secret.js.map