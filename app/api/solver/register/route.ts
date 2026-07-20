import { z } from 'zod';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createUser, getUserByEmail } from '@/lib/server/solver/db';
import { hashPassword } from '@/lib/server/solver/password';
import { setSessionCookie } from '@/lib/server/solver/session';

export const runtime = 'nodejs';

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8).max(200),
  name: z.string().trim().max(100).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      'INVALID_REQUEST',
      400,
      'A valid email and a password of at least 8 characters are required',
    );
  }

  const { email, password, name } = parsed.data;
  if (getUserByEmail(email)) {
    return apiError('ALREADY_EXISTS', 409, 'An account with this email already exists');
  }

  const passwordHash = await hashPassword(password);
  const user = createUser(email, passwordHash, name);
  await setSessionCookie(user.id);

  return apiSuccess({ user: { id: user.id, email: user.email, name: user.name } });
}
