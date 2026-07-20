'use client';

/**
 * Server sync for Math Solver classrooms. Pushes the full stage+scenes
 * snapshot from IndexedDB to the logged-in user's account
 * (PUT /api/solver/classrooms/:id) and hydrates it back on another device.
 *
 * Sync is fire-and-forget: a logged-out user (401) or offline state is a
 * silent no-op — the classroom still exists locally, exactly as before this
 * feature. Only stages flagged solverMode are ever synced.
 */

import { loadStageData, saveStageData, stageExists } from '@/lib/utils/stage-storage';
import { createLogger } from '@/lib/logger';
import type { Scene, Stage } from '@/lib/types/stage';

const log = createLogger('SolverSync');

interface SolverClassroomSnapshot {
  stage: Stage;
  scenes: Scene[];
  currentSceneId: string | null;
}

export async function syncSolverClassroom(stageId: string): Promise<void> {
  try {
    const data = await loadStageData(stageId);
    if (!data?.stage?.solverMode) return;

    const snapshot: SolverClassroomSnapshot = {
      stage: data.stage,
      scenes: data.scenes,
      currentSceneId: data.currentSceneId,
    };

    const res = await fetch(`/api/solver/classrooms/${encodeURIComponent(stageId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: data.stage.name || 'Untitled solve',
        question: data.stage.description || data.stage.name || 'Untitled solve',
        data: snapshot,
      }),
    });
    if (!res.ok && res.status !== 401) {
      log.warn(`Solver sync failed for ${stageId}: HTTP ${res.status}`);
    }
  } catch (error) {
    // Never let sync failures disturb generation/navigation.
    log.warn(`Solver sync error for ${stageId}:`, error);
  }
}

/**
 * Ensure a solver classroom exists in local IndexedDB before opening it,
 * hydrating from the user's server snapshot when missing (cross-device open).
 * The local copy always wins when present — it may hold media blobs the
 * server snapshot does not carry.
 */
export async function hydrateSolverClassroom(stageId: string): Promise<void> {
  try {
    if (await stageExists(stageId)) return;

    const res = await fetch(`/api/solver/classrooms/${encodeURIComponent(stageId)}`);
    if (!res.ok) return;

    const body = (await res.json()) as {
      classroom?: { data?: Partial<SolverClassroomSnapshot> };
    };
    const snapshot = body.classroom?.data;
    if (!snapshot?.stage || !Array.isArray(snapshot.scenes)) return;

    await saveStageData(stageId, {
      stage: snapshot.stage,
      scenes: snapshot.scenes as Scene[],
      currentSceneId: snapshot.currentSceneId ?? null,
      chats: [],
    });
  } catch (error) {
    log.warn(`Solver hydration error for ${stageId}:`, error);
  }
}
