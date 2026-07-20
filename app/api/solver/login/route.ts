import { z } from 'zod';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getUserByEmail } from '@/lib/server/solver/db';
import { hashPassword, verifyPassword } from '@/lib/server/solver/password';
import { setSessionCookie } from '@/lib/server/solver/session';

export const runtime = 'nodejs';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('INVALID_REQUEST', 400, 'Email and password are required');
  }

  const { email, password } = parsed.data;
  const user = getUserByEmail(email);

  // Always run a hash comparison so response timing does not reveal whether
  // the account exists; the error message is identical either way.
  if (!user) {
    await hashPassword(password);
    return apiError('INVALID_CREDENTIALS', 401, 'Incorrect email or password');
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return apiError('INVALID_CREDENTIALS', 401, 'Incorrect email or password');
  }

  await setSessionCookie(user.id);
  return apiSuccess({ user: { id: user.id, email: user.email, name: user.name } });
}
