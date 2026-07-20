# Math Solver SaaS Plan — Activity Toggles + Accounts & Per-User History

This document describes the design and implementation of two features scoped to the
**/solver** area of OpenMAIC, turning it into a small SaaS-style product that uses
the OpenMAIC generation engine in the background:

1. **Activity-type toggles** — the user picks which activity types the generated
   classroom may contain (Slide is always on).
2. **Accounts & per-user history** — SQLite-backed registration/login; each user
   sees only the solver classrooms they created, with full snapshots stored
   server-side so history works across devices.

The rest of the app (`/`, `/classroom/[id]`, sharing, the editor) is untouched and
continues to work without any login.

---

## Feature 1 — Activity toggles

### UX

On `/solver`, between the question box and the image dropzone, a chip row labeled
"Activities in your classroom":

- **Slide** — always selected, locked (every walkthrough is slide-backed).
- Toggles: **Quiz**, **Project** (PBL), **Simulation**, **Diagram**, **Code**,
  **Game**, **3D** — everything OpenMAIC supports. `procedural-skill` widgets are
  excluded (they stay gated behind the vocational task-engine mode).
- Default selection: Quiz (matches the previous behavior of the solver prompt).
- The last selection persists in `localStorage`.

### Data flow

```
/solver page              →  UserRequirements.solverActivities: SolverActivity[]
sessionStorage            →  generationSession (unchanged mechanism)
/generation-preview       →  POST /api/generate/scene-outlines-stream (whole requirements object)
outlines route            →  buildSolverPromptVariables() → prompt template variables
                          →  enforceSolverOutlinePolicy() → per-outline demotion
```

### Implementation

| Piece | File |
| --- | --- |
| `SolverActivity` type + `solverActivities` on `UserRequirements` | `lib/types/generation.ts` |
| Chip row UI + localStorage persistence | `app/solver/page.tsx` |
| Whitelist sanitizer, outline demotion policy, prompt variables | `lib/generation/solver-outline-policy.ts` |
| Route wiring (prompt variables + streaming-loop enforcement) | `app/api/generate/scene-outlines-stream/route.ts` |
| Dynamic prompt templates (`{{#if solverAllow*}}` blocks, `{{solverSceneTypeList}}`, `{{solverWidgetTypeList}}`) | `lib/prompts/templates/math-solver-outlines/{system,user}.md` |

Enforcement is defense-in-depth: the prompt only *describes* the allowed types;
the server **demotes** every disallowed outline the model emits anyway
(quiz/pbl/interactive → slide, configs stripped; `procedural-skill` never passes).
Demotion (rather than dropping) keeps outline `order` contiguous, mirroring the
existing task-engine normalizers.

---

## Feature 2 — Accounts & per-user history

### Storage

SQLite via `better-sqlite3` (native addon, listed in `serverExternalPackages`).
DB file: `data/solver.db` (WAL mode; `data/` is already gitignored and used for
server-side classroom shares). Override with `SOLVER_DB_PATH` (tests do this).

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,        -- nanoid
  email         TEXT NOT NULL UNIQUE,    -- stored lowercased
  password_hash TEXT NOT NULL,           -- scrypt$N$r$p$<saltHex>$<hashHex>
  name          TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE solver_classrooms (
  id         TEXT PRIMARY KEY,           -- stage id, /^[a-zA-Z0-9_-]+$/
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  question   TEXT NOT NULL,              -- the original math question
  data       TEXT NOT NULL,              -- JSON { stage, scenes, currentSceneId }
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_solver_classrooms_user ON solver_classrooms(user_id, updated_at DESC);
```

### Auth

- **Passwords**: `node:crypto` scrypt (N=16384, r=8, p=1, 32-byte salt, 64-byte
  key), self-describing hash string, timing-safe compare —
  `lib/server/solver/password.ts`.
- **Sessions**: stateless HMAC token `userId.expiresAtMs.signature`, modeled on
  the repo's existing access-code token (`lib/server/access-token.ts`), in an
  httpOnly `openmaic_solver_session` cookie (SameSite=Lax, Secure in prod,
  30 days) — `lib/server/solver/session.ts`.
- **Secret**: `SOLVER_AUTH_SECRET` env var; if unset, a random secret is
  generated once and persisted to `data/solver-auth-secret` (dev convenience).
- Login returns the same error for wrong password and unknown email, and hashes
  even for unknown emails, so neither the message nor timing leaks account
  existence.

### API (all Node runtime, `apiSuccess`/`apiError` envelope, zod-validated)

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/solver/register` | POST `{email, password≥8, name?}` | Create account, set cookie. 409 if email exists. |
| `/api/solver/login` | POST `{email, password}` | Sign in, set cookie. 401 `INVALID_CREDENTIALS`. |
| `/api/solver/logout` | POST | Clear cookie. |
| `/api/solver/me` | GET | Current user or 401. |
| `/api/solver/classrooms` | GET | Owner's history (metadata only). |
| `/api/solver/classrooms/[id]` | PUT | Upsert full snapshot (ownership-checked, id regex, 8 MB cap). |
| `/api/solver/classrooms/[id]` | GET | Full snapshot; 404 for other users' ids (no existence leak). |
| `/api/solver/classrooms/[id]` | DELETE | Delete own classroom. |

No middleware changes — auth is checked inside these routes and on the solver
page only.

### Sync & cross-device flow

- **Client sync** (`lib/solver/sync.ts` → `syncSolverClassroom`): loads the
  stage+scenes snapshot from IndexedDB and PUTs it to the server.
  Fire-and-forget; a 401 (logged out) or network failure is a silent no-op — the
  classroom still exists locally exactly as before.
  Called from:
  - `app/generation-preview/page.tsx` — right after the first scene is saved,
    before navigating to the classroom (history appears immediately).
  - `app/classroom/[id]/page.tsx` — when generation of the remaining scenes
    completes (full deck snapshot).
- **Cross-device open** (`hydrateSolverClassroom`): clicking a history item first
  checks IndexedDB; when the stage is missing locally (another device), the
  snapshot is fetched from the server, written into IndexedDB via
  `saveStageData`, and then the normal `/classroom/[id]` flow takes over.
  **The local copy always wins** when present — it can hold media blobs the
  server snapshot doesn't carry.

### /solver page behavior

- **Logged out**: the question card is replaced by an inline Sign in / Create
  account card (same orange glassmorphic design); the sidebar shows "Sign in to
  see your history."
- **Logged in**: history comes from `GET /api/solver/classrooms` (no longer from
  local IndexedDB), grouped by day with per-item delete; the avatar opens an
  account menu (email, Settings, Log out).

### Known v1 limitations

- Generated image/video blobs and chat history are **not** synced — a deck opened
  on another device shows the text/LaTeX content (solver decks are predominantly
  that) with empty media placeholders.
- Later manual edits to a finished deck are not re-synced automatically (only
  generation completion triggers a sync). Follow-up: debounced re-sync on save.
- The file-based SQLite DB requires a persistent writable `data/` directory —
  same constraint as the existing `data/classrooms` share store (i.e. targets
  self-hosted deploys, not serverless).

---

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `SOLVER_AUTH_SECRET` | HMAC key for session tokens | generated → `data/solver-auth-secret` |
| `SOLVER_DB_PATH` | SQLite file location | `data/solver.db` |

`package.json` gained `pnpm.onlyBuiltDependencies: ["better-sqlite3"]` (pnpm 10
blocks native build scripts otherwise) and `next.config.ts` lists
`better-sqlite3` in `serverExternalPackages`.

---

## Tests

- `tests/generation/solver-outline-policy.test.ts` — sanitizer + every demotion
  rule; `procedural-skill` never passes; defaults.
- `tests/generation/solver-outline-route.test.ts` — end-to-end route test with a
  mocked LLM: prompt contains only the selected types; disallowed streamed
  outlines arrive demoted.
- `tests/server/solver-auth.test.ts` — scrypt round-trip/uniqueness/malformed
  hashes; session token sign/verify/expiry/tampering.
- `tests/api/solver-routes.test.ts` — full register → login → CRUD flow against
  a temp SQLite DB, including cross-user 404 isolation and logged-out 401s.

### Manual verification checklist

1. `pnpm dev` → `/solver` shows the auth card; register → main UI; refresh keeps
   the session; logout returns to the auth card.
2. Toggle every activity off → generate → outlines are slides only, even if the
   model misbehaves. Toggle Simulation + Quiz → simulation scene renders in the
   classroom.
3. Finish a solve → the row appears in the sidebar history;
   `sqlite3 data/solver.db 'SELECT id,title FROM solver_classrooms;'` shows it.
4. Cross-device: clear the browser's IndexedDB → click the history item → the
   deck hydrates from the server and opens.
5. Regression: home-page generation, the `ACCESS_CODE` gate, and logged-out
   `/classroom/<shared-id>` all behave as before.
