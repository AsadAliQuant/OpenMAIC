import { describe, expect, test } from 'vitest';
import {
  buildSolverPromptVariables,
  enforceSolverOutlinePolicy,
  sanitizeSolverActivities,
} from '@/lib/generation/solver-outline-policy';
import type { SceneOutline } from '@/lib/types/generation';

function outline(partial: Partial<SceneOutline>): SceneOutline {
  return {
    id: 'scene_1',
    type: 'slide',
    title: 'Title',
    description: 'Description',
    keyPoints: ['point'],
    order: 1,
    ...partial,
  };
}

describe('sanitizeSolverActivities', () => {
  test('defaults to quiz-only when absent or invalid', () => {
    expect([...sanitizeSolverActivities(undefined)]).toEqual(['quiz']);
    expect([...sanitizeSolverActivities('quiz')]).toEqual(['quiz']);
    expect([...sanitizeSolverActivities({ quiz: true })]).toEqual(['quiz']);
  });

  test('keeps only whitelisted activities', () => {
    const allowed = sanitizeSolverActivities([
      'quiz',
      'simulation',
      'procedural-skill',
      'slide',
      42,
      'bogus',
    ]);
    expect([...allowed].sort()).toEqual(['quiz', 'simulation']);
  });

  test('empty array means slides only', () => {
    expect(sanitizeSolverActivities([]).size).toBe(0);
  });
});

describe('enforceSolverOutlinePolicy', () => {
  test('slide passes and is stripped of stray configs', () => {
    const result = enforceSolverOutlinePolicy(
      outline({
        type: 'slide',
        widgetType: 'game',
        widgetOutline: { concept: 'x' },
        quizConfig: { questionCount: 1, difficulty: 'easy', questionTypes: ['single'] },
      }),
      new Set(['quiz']),
    );
    expect(result.type).toBe('slide');
    expect(result.widgetType).toBeUndefined();
    expect(result.widgetOutline).toBeUndefined();
    expect(result.quizConfig).toBeUndefined();
  });

  test('quiz kept when allowed, demoted to slide when not', () => {
    const quiz = outline({
      type: 'quiz',
      quizConfig: { questionCount: 1, difficulty: 'easy', questionTypes: ['single'] },
    });
    expect(enforceSolverOutlinePolicy(quiz, new Set(['quiz'])).type).toBe('quiz');

    const demoted = enforceSolverOutlinePolicy(quiz, new Set());
    expect(demoted.type).toBe('slide');
    expect(demoted.quizConfig).toBeUndefined();
  });

  test('pbl kept when allowed, demoted when not', () => {
    const pbl = outline({
      type: 'pbl',
      pblConfig: {
        projectTopic: 'Topic',
        projectDescription: 'Desc',
        targetSkills: ['skill'],
        issueCount: 2,
      },
    });
    expect(enforceSolverOutlinePolicy(pbl, new Set(['pbl'])).type).toBe('pbl');

    const demoted = enforceSolverOutlinePolicy(pbl, new Set(['quiz']));
    expect(demoted.type).toBe('slide');
    expect(demoted.pblConfig).toBeUndefined();
  });

  test('interactive kept only for an allowed widget with a widgetOutline', () => {
    const sim = outline({
      type: 'interactive',
      widgetType: 'simulation',
      widgetOutline: { concept: 'projectile' },
    });
    expect(enforceSolverOutlinePolicy(sim, new Set(['simulation'])).type).toBe('interactive');
    expect(enforceSolverOutlinePolicy(sim, new Set(['diagram'])).type).toBe('slide');
    expect(
      enforceSolverOutlinePolicy(
        outline({ type: 'interactive', widgetType: 'simulation' }),
        new Set(['simulation']),
      ).type,
    ).toBe('slide'); // missing widgetOutline
  });

  test('procedural-skill never passes, even if somehow allowed client-side', () => {
    const procedural = outline({
      type: 'interactive',
      widgetType: 'procedural-skill',
      widgetOutline: { task: 'x' },
    });
    const allowed = sanitizeSolverActivities(['procedural-skill', 'quiz']);
    const result = enforceSolverOutlinePolicy(procedural, allowed);
    expect(result.type).toBe('slide');
    expect(result.widgetType).toBeUndefined();
  });

  test('unknown type demotes to slide', () => {
    const weird = outline({ type: 'mystery' as SceneOutline['type'] });
    expect(enforceSolverOutlinePolicy(weird, new Set(['quiz'])).type).toBe('slide');
  });
});

describe('buildSolverPromptVariables', () => {
  test('quiz-only default produces slide|quiz list and no widgets', () => {
    const vars = buildSolverPromptVariables(sanitizeSolverActivities(undefined));
    expect(vars.solverSceneTypeList).toBe('"slide" | "quiz"');
    expect(vars.solverAllowQuiz).toBe(true);
    expect(vars.solverAllowInteractive).toBe(false);
    expect(vars.solverWidgetTypeList).toBe('none');
  });

  test('full selection produces all four scene types and every widget', () => {
    const vars = buildSolverPromptVariables(
      sanitizeSolverActivities([
        'quiz',
        'pbl',
        'simulation',
        'diagram',
        'code',
        'game',
        'visualization3d',
      ]),
    );
    expect(vars.solverSceneTypeList).toBe('"slide" | "quiz" | "interactive" | "pbl"');
    expect(vars.solverWidgetTypeList).toBe(
      '"simulation" | "diagram" | "code" | "game" | "visualization3d"',
    );
    expect(vars.solverAllowPbl).toBe(true);
    expect(vars.solverAllowGame).toBe(true);
  });

  test('slides-only selection produces slide-only list', () => {
    const vars = buildSolverPromptVariables(sanitizeSolverActivities([]));
    expect(vars.solverSceneTypeList).toBe('"slide"');
    expect(vars.solverAllowQuiz).toBe(false);
    expect(vars.solverAllowInteractive).toBe(false);
  });
});
