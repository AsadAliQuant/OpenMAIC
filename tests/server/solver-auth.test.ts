import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/server/solver/password';

const SECRET_ENV = 'SOLVER_AUTH_SECRET';
let originalSecret: string | undefined;

beforeAll(() => {
  originalSecret = process.env[SECRET_ENV];
  process.env[SECRET_ENV] = 'test-secret-for-solver-auth';
});

afterAll(() => {
  if (originalSecret === undefined) {
    delete process.env[SECRET_ENV];
  } else {
    process.env[SECRET_ENV] = originalSecret;
  }
});

describe('solver password hashing', () => {
  test('round-trips a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  test('produces unique salts per hash', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same password', a)).toBe(true);
    expect(await verifyPassword('same password', b)).toBe(true);
  });

  test('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$bad$parts')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$1$2$3$aa$bb')).toBe(false);
  });
});

describe('solver session tokens', () => {
  test('signs and verifies a token', async () => {
    const { createSessionToken, verifySessionToken } = await import('@/lib/server/solver/session');
    const token = createSessionToken('user_abc123');
    expect(verifySessionToken(token)).toBe('user_abc123');
  });

  test('rejects an expired token', async () => {
    const { createSessionToken, verifySessionToken, SOLVER_SESSION_MAX_AGE_S } =
      await import('@/lib/server/solver/session');
    const issuedAt = Date.now() - (SOLVER_SESSION_MAX_AGE_S + 60) * 1000;
    const token = createSessionToken('user_abc123', issuedAt);
    expect(verifySessionToken(token)).toBeNull();
  });

  test('rejects tampered tokens', async () => {
    const { createSessionToken, verifySessionToken } = await import('@/lib/server/solver/session');
    const token = createSessionToken('user_abc123');

    // Tampered user id
    const [, expiresAt, sig] = token.split('.');
    expect(verifySessionToken(`user_evil.${expiresAt}.${sig}`)).toBeNull();

    // Tampered expiry
    const farFuture = Number(expiresAt) + 1_000_000;
    expect(verifySessionToken(`user_abc123.${farFuture}.${sig}`)).toBeNull();

    // Garbage
    expect(verifySessionToken('nonsense')).toBeNull();
    expect(verifySessionToken('')).toBeNull();
  });
});
