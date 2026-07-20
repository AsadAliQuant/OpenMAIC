/**
 * Solver outline policy — server-side enforcement of the activity toggles a
 * user picked on /solver. The math-solver-outlines prompt already tells the
 * model which scene types are allowed, but a hallucinating model can still
 * emit disallowed types; this module demotes them deterministically so the
 * generated classroom never contains an activity the user did not opt into.
 *
 * Demotion (never dropping) keeps outline `order` contiguous, mirroring
 * `applyOutlineFallbacks` and the task-engine normalizers in
 * app/api/generate/scene-outlines-stream/route.ts.
 */

import type { SceneOutline, SolverActivity } from '@/lib/types/generation';
import { SOLVER_ACTIVITY_VALUES } from '@/lib/types/generation';

/** Solver activities that map to `interactive` scene widget types. */
export const SOLVER_WIDGET_ACTIVITIES: readonly SolverActivity[] = [
  'simulation',
  'diagram',
  'code',
  'game',
  'visualization3d',
];

const VALID_ACTIVITIES = new Set<string>(SOLVER_ACTIVITY_VALUES);

/**
 * Whitelist-filter a raw `solverActivities` value from the request body.
 * Absent/invalid input defaults to quiz-only, matching the solver page's
 * default selection and the template's original slide+quiz behavior.
 */
export function sanitizeSolverActivities(raw: unknown): Set<SolverActivity> {
  if (!Array.isArray(raw)) {
    return new Set<SolverActivity>(['quiz']);
  }
  const allowed = new Set<SolverActivity>();
  for (const entry of raw) {
    if (typeof entry === 'string' && VALID_ACTIVITIES.has(entry)) {
      allowed.add(entry as SolverActivity);
    }
  }
  return allowed;
}

function demoteToSlide(outline: SceneOutline): SceneOutline {
  const slide: SceneOutline = { ...outline, type: 'slide' };
  delete slide.quizConfig;
  delete slide.pblConfig;
  delete slide.widgetType;
  delete slide.widgetOutline;
  delete slide.interactiveConfig;
  return slide;
}

/**
 * Enforce the allowed activity set on a single streamed outline.
 * `slide` always passes (stripped of stray configs); everything else must be
 * explicitly allowed or it becomes a slide.
 */
export function enforceSolverOutlinePolicy(
  outline: SceneOutline,
  allowed: ReadonlySet<SolverActivity>,
): SceneOutline {
  switch (outline.type) {
    case 'slide':
      return demoteToSlide(outline);
    case 'quiz':
      return allowed.has('quiz') ? outline : demoteToSlide(outline);
    case 'pbl':
      return allowed.has('pbl') ? outline : demoteToSlide(outline);
    case 'interactive': {
      const widgetType = outline.widgetType;
      const widgetAllowed =
        !!widgetType &&
        (SOLVER_WIDGET_ACTIVITIES as readonly string[]).includes(widgetType) &&
        allowed.has(widgetType as SolverActivity);
      // procedural-skill is never a SOLVER_WIDGET_ACTIVITIES member, so it can
      // never pass here regardless of what the client sent.
      if (widgetAllowed && outline.widgetOutline) {
        return outline;
      }
      return demoteToSlide(outline);
    }
    default:
      return demoteToSlide(outline);
  }
}

/**
 * Template variables for buildPrompt() describing the allowed activity set.
 * Keys are camelCase to satisfy the prompt-template placeholder convention.
 */
export function buildSolverPromptVariables(
  allowed: ReadonlySet<SolverActivity>,
): Record<string, unknown> {
  const widgets = SOLVER_WIDGET_ACTIVITIES.filter((w) => allowed.has(w));
  const sceneTypes = [
    '"slide"',
    ...(allowed.has('quiz') ? ['"quiz"'] : []),
    ...(widgets.length > 0 ? ['"interactive"'] : []),
    ...(allowed.has('pbl') ? ['"pbl"'] : []),
  ];
  return {
    solverAllowQuiz: allowed.has('quiz'),
    solverAllowPbl: allowed.has('pbl'),
    solverAllowInteractive: widgets.length > 0,
    solverAllowSimulation: allowed.has('simulation'),
    solverAllowDiagram: allowed.has('diagram'),
    solverAllowCode: allowed.has('code'),
    solverAllowGame: allowed.has('game'),
    solverAllowVisualization3d: allowed.has('visualization3d'),
    solverSceneTypeList: sceneTypes.join(' | '),
    solverWidgetTypeList: widgets.map((w) => `"${w}"`).join(' | ') || 'none',
  };
}
