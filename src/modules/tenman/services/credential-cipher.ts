import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class CredentialCipher {
  private readonly key: Buffer;

  public constructor(encodedKey: string) {
    this.key = Buffer.from(encodedKey, 'base64');
    if (this.key.length !== 32) throw new Error('Credential encryption key must be 32 bytes');
  }

  public encrypt(plaintext: string, context: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      'v1',
      nonce.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  public decrypt(value: string, context: string): string {
    const [version, nonceValue, tagValue, ciphertextValue, extra] = value.split('.');
    if (
      version !== 'v1' ||
      nonceValue === undefined ||
      tagValue === undefined ||
      ciphertextValue === undefined ||
      extra !== undefined
    ) {
      throw new Error('Invalid encrypted credential');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(nonceValue, 'base64url'),
    );
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
