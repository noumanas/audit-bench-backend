import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptToken, encryptToken, requireEncryptionKey } from './token-crypto';

/** Encrypts/decrypts GitHub/GitLab tokens at rest — see token-crypto.ts for the scheme. */
@Injectable()
export class TokenCryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = requireEncryptionKey(config);
  }

  encrypt(plaintext: string): string {
    return encryptToken(plaintext, this.key);
  }

  decrypt(stored: string): string {
    return decryptToken(stored, this.key);
  }
}
