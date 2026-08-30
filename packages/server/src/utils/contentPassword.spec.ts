import { isScryptPasswordHash } from './crypto';
import {
  hashContentPassword,
  MAX_CONTENT_PASSWORD_LENGTH,
  verifyContentPassword,
} from './contentPassword';

describe('content passwords', () => {
  it('hashes new passwords with scrypt and verifies them', async () => {
    const stored = await hashContentPassword('correct horse battery staple');

    expect(stored).not.toContain('correct horse battery staple');
    expect(isScryptPasswordHash(stored)).toBe(true);
    await expect(verifyContentPassword('correct horse battery staple', stored)).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
    await expect(verifyContentPassword('wrong', stored)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('accepts a legacy plaintext password once and requests migration', async () => {
    await expect(verifyContentPassword('legacy-secret', 'legacy-secret')).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
    await expect(verifyContentPassword('wrong', 'legacy-secret')).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('does not treat a malformed scrypt value as plaintext', async () => {
    const malformed = 'scrypt$v1$not-a-valid-hash';
    await expect(verifyContentPassword(malformed, malformed)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('rejects empty and excessively long passwords', async () => {
    await expect(hashContentPassword('')).rejects.toThrow(TypeError);
    await expect(hashContentPassword('x'.repeat(MAX_CONTENT_PASSWORD_LENGTH + 1))).rejects.toThrow(
      TypeError,
    );
  });
});
