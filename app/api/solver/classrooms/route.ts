import { apiError, apiSuccess } from '@/lib/server/api-response';
import { listSolverClassrooms } from '@/lib/server/solver/db';
import { getSolverUser } from '@/lib/server/solver/session';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getSolverUser();
  if (!user) {
    return apiError('UNAUTHORIZED', 401, 'Not signed in');
  }
  return apiSuccess({ classrooms: listSolverClassrooms(user.id) });
}
