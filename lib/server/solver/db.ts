/**
 * SQLite database for the Math Solver SaaS layer (users + per-user classroom
 * snapshots). Server-only — never import from middleware (Edge runtime) or
 * client code; the only consumers are the app/api/solver/* route handlers.
 *
 * The DB file lives under data/ next to data/classrooms (see
 * lib/server/classroom-storage.ts for the convention). Tests can point
 * SOLVER_DB_PATH at a temp file.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

export interface SolverUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string | null;
  createdAt: number;
}

export interface SolverClassroomMeta {
  id: string;
  title: string;
  question: string;
  createdAt: number;
  updatedAt: number;
}

export interface SolverClassroomRecord extends SolverClassroomMeta {
  /** JSON string: { stage, scenes, currentSceneId } */
  data: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS solver_classrooms (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  question   TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_solver_classrooms_user
  ON solver_classrooms(user_id, updated_at DESC);
`;

function resolveDbPath(): string {
  return process.env.SOLVER_DB_PATH || path.join(process.cwd(), 'data', 'solver.db');
}

function openDatabase(): Database.Database {
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

// Survive Next.js dev-mode HMR: module state is reset on recompile, but
// globalThis persists for the process lifetime. Keyed by path so tests that
// switch SOLVER_DB_PATH get a fresh handle.
const globalStore = globalThis as unknown as {
  __solverDb?: { path: string; db: Database.Database };
};

export function getSolverDb(): Database.Database {
  const dbPath = resolveDbPath();
  if (!globalStore.__solverDb || globalStore.__solverDb.path !== dbPath) {
    globalStore.__solverDb = { path: dbPath, db: openDatabase() };
  }
  return globalStore.__solverDb.db;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  created_at: number;
}

function toUser(row: UserRow): SolverUser {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name,
    createdAt: row.created_at,
  };
}

export function createUser(email: string, passwordHash: string, name?: string): SolverUser {
  const user: SolverUser = {
    id: nanoid(),
    email: email.trim().toLowerCase(),
    passwordHash,
    name: name?.trim() || null,
    createdAt: Date.now(),
  };
  getSolverDb()
    .prepare(
      'INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(user.id, user.email, user.passwordHash, user.name, user.createdAt);
  return user;
}

export function getUserByEmail(email: string): SolverUser | null {
  const row = getSolverDb()
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email.trim().toLowerCase()) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function getUserById(id: string): SolverUser | null {
  const row = getSolverDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as
    | UserRow
    | undefined;
  return row ? toUser(row) : null;
}

interface ClassroomRow {
  id: string;
  user_id: string;
  title: string;
  question: string;
  data: string;
  created_at: number;
  updated_at: number;
}

export function upsertSolverClassroom(
  userId: string,
  classroom: { id: string; title: string; question: string; data: string },
): { updatedAt: number } {
  const now = Date.now();
  const db = getSolverDb();
  // Ownership check happens here, not in a separate read: an INSERT .. ON
  // CONFLICT would let user B overwrite user A's row with the same stage id.
  const existing = db
    .prepare('SELECT user_id FROM solver_classrooms WHERE id = ?')
    .get(classroom.id) as { user_id: string } | undefined;
  if (existing && existing.user_id !== userId) {
    throw new SolverOwnershipError(classroom.id);
  }
  if (existing) {
    db.prepare(
      'UPDATE solver_classrooms SET title = ?, question = ?, data = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    ).run(classroom.title, classroom.question, classroom.data, now, classroom.id, userId);
  } else {
    db.prepare(
      'INSERT INTO solver_classrooms (id, user_id, title, question, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(classroom.id, userId, classroom.title, classroom.question, classroom.data, now, now);
  }
  return { updatedAt: now };
}

export class SolverOwnershipError extends Error {
  constructor(classroomId: string) {
    super(`Classroom ${classroomId} belongs to another user`);
    this.name = 'SolverOwnershipError';
  }
}

export function listSolverClassrooms(userId: string): SolverClassroomMeta[] {
  const rows = getSolverDb()
    .prepare(
      'SELECT id, title, question, created_at, updated_at FROM solver_classrooms WHERE user_id = ? ORDER BY updated_at DESC',
    )
    .all(userId) as Omit<ClassroomRow, 'user_id' | 'data'>[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    question: r.question,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getSolverClassroom(id: string, userId: string): SolverClassroomRecord | null {
  const row = getSolverDb()
    .prepare('SELECT * FROM solver_classrooms WHERE id = ? AND user_id = ?')
    .get(id, userId) as ClassroomRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    question: row.question,
    data: row.data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function deleteSolverClassroom(id: string, userId: string): boolean {
  const result = getSolverDb()
    .prepare('DELETE FROM solver_classrooms WHERE id = ? AND user_id = ?')
    .run(id, userId);
  return result.changes > 0;
}
