import { z } from 'zod';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  deleteSolverClassroom,
  getSolverClassroom,
  SolverOwnershipError,
  upsertSolverClassroom,
} from '@/lib/server/solver/db';
import { getSolverUser } from '@/lib/server/solver/session';

export const runtime = 'nodejs';

// Same id shape the classroom share flow enforces (lib/server/classroom-storage.ts).
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Full stage+scenes snapshots are typically well under 1 MB of JSON; 8 MB
// leaves generous headroom while bounding what one row can hold.
const MAX_DATA_BYTES = 8 * 1024 * 1024;

const putSchema = z.object({
  title: z.string().trim().min(1).max(300),
  question: z.string().trim().min(1).max(4000),
  // Snapshot shape { stage, scenes, currentSceneId } is produced and consumed
  // by our own client (lib/solver/sync.ts / the solver page hydrator); the
  // server treats it as an opaque, size-bounded document.
  data: z.object({
    stage: z.record(z.string(), z.unknown()),
    scenes: z.array(z.unknown()),
    currentSceneId: z.string().nullish(),
  }),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  const user = await getSolverUser();
  if (!user) {
    return apiError('UNAUTHORIZED', 401, 'Not signed in');
  }

  const { id } = await context.params;
  if (!ID_PATTERN.test(id)) {
    return apiError('INVALID_REQUEST', 400, 'Invalid classroom id');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('INVALID_REQUEST', 400, 'title, question and data are required');
  }

  const data = JSON.stringify(parsed.data.data);
  if (Buffer.byteLength(data, 'utf-8') > MAX_DATA_BYTES) {
    return apiError('INVALID_REQUEST', 400, 'Classroom snapshot is too large');
  }

  try {
    const { updatedAt } = upsertSolverClassroom(user.id, {
      id,
      title: parsed.data.title,
      question: parsed.data.question,
      data,
    });
    return apiSuccess({ id, updatedAt });
  } catch (error) {
    if (error instanceof SolverOwnershipError) {
      // Same response as a missing classroom — no cross-user existence leak.
      return apiError('NOT_FOUND', 404, 'Classroom not found');
    }
    throw error;
  }
}

export async function GET(request: Request, context: RouteContext) {
  const user = await getSolverUser();
  if (!user) {
    return apiError('UNAUTHORIZED', 401, 'Not signed in');
  }

  const { id } = await context.params;
  if (!ID_PATTERN.test(id)) {
    return apiError('INVALID_REQUEST', 400, 'Invalid classroom id');
  }

  const classroom = getSolverClassroom(id, user.id);
  if (!classroom) {
    return apiError('NOT_FOUND', 404, 'Classroom not found');
  }

  return apiSuccess({
    classroom: {
      id: classroom.id,
      title: classroom.title,
      question: classroom.question,
      data: JSON.parse(classroom.data) as unknown,
      createdAt: classroom.createdAt,
      updatedAt: classroom.updatedAt,
    },
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getSolverUser();
  if (!user) {
    return apiError('UNAUTHORIZED', 401, 'Not signed in');
  }

  const { id } = await context.params;
  if (!ID_PATTERN.test(id)) {
    return apiError('INVALID_REQUEST', 400, 'Invalid classroom id');
  }

  const deleted = deleteSolverClassroom(id, user.id);
  if (!deleted) {
    return apiError('NOT_FOUND', 404, 'Classroom not found');
  }
  return apiSuccess({ deleted: true });
}
