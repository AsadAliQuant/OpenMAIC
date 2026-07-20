/**
 * Stateless HMAC session tokens for solver accounts, modeled on
 * lib/server/access-token.ts but keyed per-user with an expiry:
 * `<userId>.<expiresAtMs>.<hmacSHA256Hex(secret, userId.expiresAtMs)>`.
 *
 * Server-only (Node runtime). The signing secret comes from
 * SOLVER_AUTH_SECRET, with a dev fallback persisted under data/ so sessions
 * survive restarts without any configuration.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';
import { getUserById, type SolverUser } from './db';

const log = createLogger('SolverSession');

export const SOLVER_SESSION_COOKIE = 'openmaic_solver_session';
export const SOLVER_SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

let cachedFallbackSecret: string | null = null;

function getSecret(): string {
  const configured = process.env.SOLVER_AUTH_SECRET;
  if (configured) return configured;

  if (cachedFallbackSecret) return cachedFallbackSecret;

  // Dev fallback: mint a random secret once and persist it under data/ (same
  // server-writable location as data/classrooms) so restarts keep sessions valid.
  const secretPath = path.join(process.cwd(), 'data', 'solver-auth-secret');
  try {
    cachedFallbackSecret = fs.readFileSync(secretPath, 'utf-8').trim();
    if (cachedFallbackSecret) return cachedFallbackSecret;
  } catch {
    // fall through to generation
  }
  const generated = randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  } catch (error) {
    log.warn('Could not persist generated SOLVER_AUTH_SECRET fallback:', error);
  }
  log.warn('SOLVER_AUTH_SECRET is not set — using a generated secret from data/solver-auth-secret');
  cachedFallbackSecret = generated;
  return generated;
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('hex');
}

export function createSessionToken(userId: string, now = Date.now()): string {
  const expiresAt = now + SOLVER_SESSION_MAX_AGE_S * 1000;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string, now = Date.now()): string | null {
  // Split from the right: user ids are nanoid ([A-Za-z0-9_-], no dots), but be
  // defensive against malformed input anyway.
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return null;
  const payload = token.substring(0, lastDot);
  const signature = token.substring(lastDot + 1);

  const midDot = payload.lastIndexOf('.');
  if (midDot === -1) return null;
  const userId = payload.substring(0, midDot);
  const expiresAt = Number(payload.substring(midDot + 1));
  if (!userId || !Number.isFinite(expiresAt)) return null;

  const expected = sign(payload);
  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(signature, 'hex');
  } catch {
    return null;
  }
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

  if (now > expiresAt) return null;
  return userId;
}

/** Set the session cookie for a freshly registered/logged-in user. */
export async function setSessionCookie(userId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SOLVER_SESSION_COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SOLVER_SESSION_MAX_AGE_S,
    secure: process.env.NODE_ENV === 'production',
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SOLVER_SESSION_COOKIE);
}

/** Resolve the logged-in solver user from the request cookie, or null. */
export async function getSolverUser(): Promise<SolverUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SOLVER_SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = verifySessionToken(token);
  if (!userId) return null;
  return getUserById(userId);
}
