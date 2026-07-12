import * as crypto from 'crypto';
import { decryptToken, encryptToken } from './token-crypto';

describe('token-crypto', () => {
  const key = crypto.randomBytes(32);

  it('round-trips a token through encrypt then decrypt', () => {
    const plaintext = 'ghp_abc123def456';
    const encrypted = encryptToken(plaintext, key);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    expect(decryptToken(encrypted, key)).toBe(plaintext);
  });

  it('produces a different ciphertext each time (random IV) even for the same plaintext', () => {
    const plaintext = 'same-token-value';
    expect(encryptToken(plaintext, key)).not.toBe(encryptToken(plaintext, key));
  });

  it('passes through a legacy plaintext value unchanged (no enc:v1: prefix)', () => {
    expect(decryptToken('a-plain-legacy-token', key)).toBe('a-plain-legacy-token');
  });

  it('fails to decrypt with the wrong key rather than silently returning garbage', () => {
    const encrypted = encryptToken('secret-value', key);
    const wrongKey = crypto.randomBytes(32);
    expect(() => decryptToken(encrypted, wrongKey)).toThrow();
  });
});
