import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

// In-memory cookie jar standing in for next/headers request cookies, so the
// route handlers can run outside a real Next request scope.
const cookieJar = vi.hoisted(() => new Map<string, string>());

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name) as string } : undefined,
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));

let tempDir: string;
let originalDbPath: string | undefined;
let originalSecret: string | undefined;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solver-db-test-'));
  originalDbPath = process.env.SOLVER_DB_PATH;
  originalSecret = process.env.SOLVER_AUTH_SECRET;
  process.env.SOLVER_DB_PATH = path.join(tempDir, 'solver.db');
  process.env.SOLVER_AUTH_SECRET = 'test-secret-for-solver-routes';
});

afterAll(() => {
  if (originalDbPath === undefined) delete process.env.SOLVER_DB_PATH;
  else process.env.SOLVER_DB_PATH = originalDbPath;
  if (originalSecret === undefined) delete process.env.SOLVER_AUTH_SECRET;
  else process.env.SOLVER_AUTH_SECRET = originalSecret;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/solver/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const classroomSnapshot = {
  stage: { id: 'stage1234ab', name: 'Solving x²', solverMode: true },
  scenes: [{ id: 'scene_1', type: 'slide', order: 1 }],
  currentSceneId: 'scene_1',
};

describe('solver auth + classroom routes', () => {
  test('full register → me → classroom CRUD → cross-user isolation flow', async () => {
    const { POST: register } = await import('@/app/api/solver/register/route');
    const { POST: login } = await import('@/app/api/solver/login/route');
    const { POST: logout } = await import('@/app/api/solver/logout/route');
    const { GET: me } = await import('@/app/api/solver/me/route');
    const { GET: listClassrooms } = await import('@/app/api/solver/classrooms/route');
    const {
      PUT: putClassroom,
      GET: getClassroom,
      DELETE: deleteClassroom,
    } = await import('@/app/api/solver/classrooms/[id]/route');

    const idContext = (id: string) => ({ params: Promise.resolve({ id }) });

    // Logged out: everything auth-gated is 401.
    cookieJar.clear();
    expect((await me()).status).toBe(401);
    expect((await listClassrooms()).status).toBe(401);

    // Register user A (sets the session cookie).
    const regRes = await register(
      jsonRequest({ email: 'Alice@Example.com', password: 'password123', name: 'Alice' }),
    );
    expect(regRes.status).toBe(200);
    const regBody = await regRes.json();
    expect(regBody.user.email).toBe('alice@example.com');
    expect(cookieJar.has('openmaic_solver_session')).toBe(true);

    // Duplicate email → 409 regardless of case.
    const dupRes = await register(
      jsonRequest({ email: 'alice@example.com', password: 'password123' }),
    );
    expect(dupRes.status).toBe(409);

    // me returns the logged-in user.
    const meRes = await me();
    expect(meRes.status).toBe(200);
    expect((await meRes.json()).user.email).toBe('alice@example.com');

    // Save a classroom snapshot.
    const putRes = await putClassroom(
      jsonRequest({ title: 'Solving x²', question: 'Solve x^2+5x+6=0', data: classroomSnapshot }),
      idContext('stage1234ab'),
    );
    expect(putRes.status).toBe(200);

    // Invalid id shape rejected.
    expect(
      (
        await putClassroom(
          jsonRequest({ title: 't', question: 'q', data: classroomSnapshot }),
          idContext('../evil'),
        )
      ).status,
    ).toBe(400);

    // List and fetch it back.
    const listRes = await listClassrooms();
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.classrooms).toHaveLength(1);
    expect(listBody.classrooms[0]).toMatchObject({ id: 'stage1234ab', title: 'Solving x²' });
    expect(listBody.classrooms[0].data).toBeUndefined();

    const getRes = await getClassroom(jsonRequest({}), idContext('stage1234ab'));
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.classroom.data.stage.name).toBe('Solving x²');

    // Wrong password cannot log in.
    cookieJar.clear();
    const badLogin = await login(
      jsonRequest({ email: 'alice@example.com', password: 'wrong-password' }),
    );
    expect(badLogin.status).toBe(401);
    // Unknown account gets the same error shape (no existence leak).
    const unknownLogin = await login(
      jsonRequest({ email: 'nobody@example.com', password: 'password123' }),
    );
    expect(unknownLogin.status).toBe(401);
    expect((await badLogin.json()).error).toBe((await unknownLogin.json()).error);

    // User B cannot see or overwrite user A's classroom.
    const regB = await register(jsonRequest({ email: 'bob@example.com', password: 'password123' }));
    expect(regB.status).toBe(200);
    expect((await getClassroom(jsonRequest({}), idContext('stage1234ab'))).status).toBe(404);
    expect(
      (
        await putClassroom(
          jsonRequest({ title: 'hijack', question: 'q', data: classroomSnapshot }),
          idContext('stage1234ab'),
        )
      ).status,
    ).toBe(404);
    expect((await deleteClassroom(jsonRequest({}), idContext('stage1234ab'))).status).toBe(404);
    expect((await (await listClassrooms()).json()).classrooms).toHaveLength(0);

    // Back as A: login works, delete works.
    cookieJar.clear();
    const loginRes = await login(
      jsonRequest({ email: 'alice@example.com', password: 'password123' }),
    );
    expect(loginRes.status).toBe(200);
    expect((await deleteClassroom(jsonRequest({}), idContext('stage1234ab'))).status).toBe(200);
    expect((await (await listClassrooms()).json()).classrooms).toHaveLength(0);

    // Logout clears the cookie.
    await logout();
    expect(cookieJar.has('openmaic_solver_session')).toBe(false);
    expect((await me()).status).toBe(401);
  });

  test('register validates email and password length', async () => {
    const { POST: register } = await import('@/app/api/solver/register/route');
    cookieJar.clear();
    expect(
      (await register(jsonRequest({ email: 'not-an-email', password: 'password123' }))).status,
    ).toBe(400);
    expect(
      (await register(jsonRequest({ email: 'ok@example.com', password: 'short' }))).status,
    ).toBe(400);
  });
});
