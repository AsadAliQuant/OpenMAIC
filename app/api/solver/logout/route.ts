import { apiSuccess } from '@/lib/server/api-response';
import { clearSessionCookie } from '@/lib/server/solver/session';

export const runtime = 'nodejs';

export async function POST() {
  await clearSessionCookie();
  return apiSuccess({});
}
