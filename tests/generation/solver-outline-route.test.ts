import { describe, expect, test, vi } from 'vitest';

const streamLLMMock = vi.hoisted(() => vi.fn());
const resolveModelFromRequestMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/ai/llm', () => ({
  streamLLM: streamLLMMock,
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromRequest: resolveModelFromRequestMock,
}));

async function readStreamBody(response: Response) {
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();
  const decoder = new TextDecoder();
  let text = '';

  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  return text;
}

function parseSseEvents(text: string) {
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
}

function mockRequest(requirements: Record<string, unknown>) {
  return {
    json: async () => ({
      requirements,
      pdfText: '',
      pdfImages: [],
      imageMapping: {},
      researchContext: '',
    }),
    headers: {
      get: () => null,
    },
  };
}

describe('solver outline route', () => {
  test('shapes the prompt from solverActivities and demotes disallowed outline types', async () => {
    vi.resetModules();
    streamLLMMock.mockReset();
    resolveModelFromRequestMock.mockReset();

    resolveModelFromRequestMock.mockResolvedValue({
      model: { provider: 'glm.chat', modelId: 'glm-5.1' },
      modelInfo: { outputWindow: 4096, capabilities: {} },
      modelString: 'glm:glm-5.1',
      providerId: 'glm',
      modelId: 'glm-5.1',
      thinkingConfig: undefined,
    });

    const outlineResponse = JSON.stringify({
      languageDirective: 'Tutor in English with LaTeX notation.',
      courseTitle: 'Solving x² + 5x + 6 = 0',
      outlines: [
        {
          id: 'scene_slide',
          type: 'slide',
          title: 'Understand the problem',
          description: 'Restate the equation.',
          keyPoints: ['Solve $x^2+5x+6=0$'],
          order: 1,
        },
        {
          id: 'scene_sim',
          type: 'interactive',
          title: 'Graph it',
          description: 'Explore the parabola.',
          keyPoints: ['Roots are x-intercepts'],
          order: 2,
          widgetType: 'simulation',
          widgetOutline: { concept: 'parabola roots', keyVariables: ['a', 'b', 'c'] },
        },
        {
          id: 'scene_game',
          type: 'interactive',
          title: 'Factoring game',
          description: 'Not allowed — game was not toggled on.',
          keyPoints: ['Should demote'],
          order: 3,
          widgetType: 'game',
          widgetOutline: { challenge: 'factor race' },
        },
        {
          id: 'scene_pbl',
          type: 'pbl',
          title: 'Mini project',
          description: 'Not allowed — pbl was not toggled on.',
          keyPoints: ['Should demote'],
          order: 4,
          pblConfig: {
            projectTopic: 'Quadratics',
            projectDescription: 'Project',
            targetSkills: ['factoring'],
            issueCount: 2,
          },
        },
        {
          id: 'scene_quiz',
          type: 'quiz',
          title: 'Try it yourself',
          description: 'Practice.',
          keyPoints: ['Solve $x^2+7x+12=0$'],
          order: 5,
          quizConfig: { questionCount: 1, difficulty: 'easy', questionTypes: ['short_answer'] },
        },
      ],
    });

    streamLLMMock.mockReturnValue({
      textStream: (async function* () {
        yield outlineResponse;
      })(),
    });

    const { POST } = await import('@/app/api/generate/scene-outlines-stream/route');
    const response = await POST(
      mockRequest({
        requirement: 'Solve x^2 + 5x + 6 = 0',
        solverMode: true,
        solverActivities: ['quiz', 'simulation'],
      }) as unknown as Parameters<typeof POST>[0],
    );

    // The solver prompt reflects the selected activities only.
    const promptParams = streamLLMMock.mock.calls[0][0] as { system: string; prompt: string };
    expect(promptParams.system).toContain('Math Solver');
    expect(promptParams.system).toContain('"slide" | "quiz" | "interactive"');
    expect(promptParams.system).toContain('"simulation"');
    expect(promptParams.system).not.toContain('"game"');
    expect(promptParams.system).not.toContain('| "pbl"');
    expect(promptParams.system).not.toContain('{{solverSceneTypeList}}');
    expect(promptParams.system).not.toContain('{{#if');
    expect(promptParams.prompt).not.toContain('{{solverSceneTypeList}}');

    const events = parseSseEvents(await readStreamBody(response));
    const done = events.find((event) => event.type === 'done');
    expect(done).toBeDefined();
    expect(done.outlines).toHaveLength(5);

    // Allowed types pass through untouched.
    expect(done.outlines[0].type).toBe('slide');
    expect(done.outlines[1]).toMatchObject({ type: 'interactive', widgetType: 'simulation' });
    expect(done.outlines[4]).toMatchObject({ type: 'quiz' });
    expect(done.outlines[4].quizConfig).toBeDefined();

    // Disallowed types are demoted to slides with configs stripped.
    expect(done.outlines[2].type).toBe('slide');
    expect(done.outlines[2].widgetType).toBeUndefined();
    expect(done.outlines[3].type).toBe('slide');
    expect(done.outlines[3].pblConfig).toBeUndefined();
  });

  test('defaults to slide+quiz when solverActivities is absent', async () => {
    vi.resetModules();
    streamLLMMock.mockReset();
    resolveModelFromRequestMock.mockReset();

    resolveModelFromRequestMock.mockResolvedValue({
      model: { provider: 'glm.chat', modelId: 'glm-5.1' },
      modelInfo: { outputWindow: 4096, capabilities: {} },
      modelString: 'glm:glm-5.1',
      providerId: 'glm',
      modelId: 'glm-5.1',
      thinkingConfig: undefined,
    });

    streamLLMMock.mockReturnValue({
      textStream: (async function* () {
        yield JSON.stringify({
          languageDirective: 'Tutor in English.',
          courseTitle: 'Derivative of x³',
          outlines: [
            {
              id: 'scene_1',
              type: 'interactive',
              title: 'Explore',
              description: 'Interactive is not allowed by default.',
              keyPoints: ['demote me'],
              order: 1,
              widgetType: 'simulation',
              widgetOutline: { concept: 'slope' },
            },
          ],
        });
      })(),
    });

    const { POST } = await import('@/app/api/generate/scene-outlines-stream/route');
    const response = await POST(
      mockRequest({
        requirement: 'Differentiate x^3',
        solverMode: true,
      }) as unknown as Parameters<typeof POST>[0],
    );

    const promptParams = streamLLMMock.mock.calls[0][0] as { system: string };
    expect(promptParams.system).toContain('"slide" | "quiz"');
    expect(promptParams.system).not.toContain('"interactive"');

    const events = parseSseEvents(await readStreamBody(response));
    const done = events.find((event) => event.type === 'done');
    expect(done.outlines[0].type).toBe('slide');
    expect(done.outlines[0].widgetType).toBeUndefined();
  });
});
