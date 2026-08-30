import {
  encryptLegacyPassword,
  encryptPassword,
  timingSafeStringEqual,
  verifyPassword,
} from './crypto';

describe('password crypto', () => {
  const username = 'admin';
  const password = 'browser-side-password-digest';
  const legacySalt = 'legacy-salt';

  it('creates a versioned scrypt hash with a unique random salt', async () => {
    const first = await encryptPassword(username, password, legacySalt);
    const second = await encryptPassword(username, password, legacySalt);

    expect(first).toMatch(/^scrypt\$v1\$32768\$8\$1\$/);
    expect(second).toMatch(/^scrypt\$v1\$32768\$8\$1\$/);
    expect(first).not.toBe(second);
  });

  it('accepts the right password and rejects a wrong password', async () => {
    const hash = await encryptPassword(username, password, legacySalt);

    await expect(verifyPassword(username, password, legacySalt, hash)).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
    await expect(verifyPassword(username, 'wrong-password', legacySalt, hash)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('keeps legacy SHA-256 verification for transparent migration', async () => {
    const legacyHash = encryptLegacyPassword(username, password, legacySalt);

    await expect(verifyPassword(username, password, legacySalt, legacyHash)).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
    await expect(
      verifyPassword(username, 'wrong-password', legacySalt, legacyHash),
    ).resolves.toEqual({ valid: false, needsRehash: true });
  });

  it('rejects malformed hashes without throwing', async () => {
    await expect(
      verifyPassword(username, password, legacySalt, 'scrypt$v1$32768$8$1$bad$bad'),
    ).resolves.toEqual({ valid: false, needsRehash: false });
  });

  it('compares secret strings safely', () => {
    expect(timingSafeStringEqual('same-secret', 'same-secret')).toBe(true);
    expect(timingSafeStringEqual('same-secret', 'different-secret')).toBe(false);
  });
});
