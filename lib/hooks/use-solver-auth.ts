'use client';

/**
 * Client-side auth state for the /solver area. Wraps the app/api/solver/*
 * auth endpoints with plain fetch — only the solver page consumes this, so no
 * global store is needed. The session itself lives in an httpOnly cookie.
 */

import { useCallback, useEffect, useState } from 'react';

export interface SolverAuthUser {
  id: string;
  email: string;
  name: string | null;
}

interface AuthEnvelope {
  success?: boolean;
  user?: SolverAuthUser;
  error?: string;
}

async function parseEnvelope(res: Response): Promise<AuthEnvelope> {
  try {
    return (await res.json()) as AuthEnvelope;
  } catch {
    return {};
  }
}

export function useSolverAuth() {
  const [user, setUser] = useState<SolverAuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/solver/me');
      const body = await parseEnvelope(res);
      setUser(res.ok && body.user ? body.user : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const authenticate = useCallback(
    async (
      endpoint: 'login' | 'register',
      payload: Record<string, string>,
    ): Promise<string | null> => {
      try {
        const res = await fetch(`/api/solver/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await parseEnvelope(res);
        if (res.ok && body.user) {
          setUser(body.user);
          return null;
        }
        return body.error || 'Something went wrong. Please try again.';
      } catch {
        return 'Network error. Please try again.';
      }
    },
    [],
  );

  const login = useCallback(
    (email: string, password: string) => authenticate('login', { email, password }),
    [authenticate],
  );

  const register = useCallback(
    (email: string, password: string, name?: string) =>
      authenticate('register', { email, password, ...(name ? { name } : {}) }),
    [authenticate],
  );

  const logout = useCallback(async () => {
    try {
      await fetch('/api/solver/logout', { method: 'POST' });
    } catch {
      // Cookie clearing failed on the network level — still drop local state.
    }
    setUser(null);
  }, []);

  return { user, loading, refresh, login, register, logout };
}
