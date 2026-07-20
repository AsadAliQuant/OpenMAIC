import { describe, expect, it } from 'vitest';
import type { PPTTextElement, SpotlightAction, SpeechAction, Action } from '@openmaic/dsl';
import {
  extractTextLines,
  isVaraWritable,
  cursiveFallbackFor,
  stripInlineFontFamilies,
  extractDominantFontSizePx,
  extractDominantColor,
  planSceneHandwriting,
  HANDWRITING_MIN_MS,
  HANDWRITING_MAX_MS,
  HANDWRITING_STAGGER_MS,
  estimateHandwritingDurationMs,
} from '@/lib/choreography';

function textEl(id: string, content: string, overrides: Partial<PPTTextElement> = {}): PPTTextElement {
  return {
    id,
    type: 'text',
    left: 0,
    top: 0,
    width: 400,
    height: 100,
    rotate: 0,
    content,
    defaultFontName: 'Microsoft YaHei',
    defaultColor: '#333333',
    ...overrides,
  };
}

function spotlight(elementId: string): SpotlightAction {
  return { id: `sp-${elementId}`, type: 'spotlight', elementId };
}

function speech(text: string): SpeechAction {
  return { id: `sp-${text.slice(0, 4)}`, type: 'speech', text };
}

describe('estimateHandwritingDurationMs', () => {
  it('clamps to [MIN, MAX] and scales with length', () => {
    expect(estimateHandwritingDurationMs('')).toBe(HANDWRITING_MIN_MS);
    expect(estimateHandwritingDurationMs('hi')).toBe(HANDWRITING_MIN_MS);
    expect(estimateHandwritingDurationMs('x'.repeat(1000))).toBe(HANDWRITING_MAX_MS);
    expect(HANDWRITING_MAX_MS).toBeLessThan(5000); // must stay under EFFECT_AUTO_CLEAR_MS
  });
});

describe('extractTextLines', () => {
  it('splits on <br> and block boundaries, strips tags, decodes entities', () => {
    expect(extractTextLines('<p>Hello&nbsp;world</p><p>Second line</p>')).toEqual([
      'Hello world',
      'Second line',
    ]);
    expect(extractTextLines('Line one<br>Line two')).toEqual(['Line one', 'Line two']);
    expect(extractTextLines('<ul><li>A</li><li>B</li></ul>')).toEqual(['A', 'B']);
  });

  it('collapses whitespace and drops empty lines', () => {
    expect(extractTextLines('<p>  a   b  </p><p></p><p>c</p>')).toEqual(['a b', 'c']);
  });

  it('returns empty array for empty input', () => {
    expect(extractTextLines('')).toEqual([]);
  });
});

describe('isVaraWritable — eligibility routing', () => {
  it('plain Latin text is vara-writable', () => {
    expect(isVaraWritable('<p>The quick brown fox</p>')).toBe(true);
  });

  it('CJK content is not vara-writable', () => {
    expect(isVaraWritable('<p>你好世界</p>')).toBe(false);
  });

  it('bullet lists are not vara-writable', () => {
    expect(isVaraWritable('<ul><li>one</li><li>two</li></ul>')).toBe(false);
  });

  it('tables are not vara-writable', () => {
    expect(isVaraWritable('<table><tr><td>x</td></tr></table>')).toBe(false);
  });

  it('images are not vara-writable', () => {
    expect(isVaraWritable('<p>caption</p><img src="x.png" />')).toBe(false);
  });

  it('KaTeX markup is not vara-writable', () => {
    expect(isVaraWritable('<span class="katex">x^2</span>')).toBe(false);
  });

  it('empty content is not vara-writable', () => {
    expect(isVaraWritable('')).toBe(false);
    expect(isVaraWritable('<p></p>')).toBe(false);
  });
});

describe('cursiveFallbackFor — wipe-mode font routing', () => {
  it('CJK routes to LXGW WenKai', () => {
    expect(cursiveFallbackFor('<p>你好</p>')).toBe('LXGW WenKai');
  });

  it('KaTeX/table/image content keeps authored styling (null)', () => {
    expect(cursiveFallbackFor('<span class="katex">x^2</span>')).toBeNull();
    expect(cursiveFallbackFor('<table><tr><td>x</td></tr></table>')).toBeNull();
    expect(cursiveFallbackFor('<img src="x.png" />')).toBeNull();
  });

  it('plain Latin rich content (e.g. bullet lists) routes to Caveat', () => {
    expect(cursiveFallbackFor('<ul><li>one</li></ul>')).toBe('Caveat');
  });
});

describe('stripInlineFontFamilies', () => {
  it('removes font-family declarations, keeps other style', () => {
    const html = '<span style="font-family: Arial; color: red;">hi</span>';
    const stripped = stripInlineFontFamilies(html);
    expect(stripped).not.toMatch(/font-family/i);
    expect(stripped).toMatch(/color: red/);
  });
});

describe('extractDominantFontSizePx', () => {
  it('reads the first inline font-size', () => {
    expect(extractDominantFontSizePx('<p style="font-size: 32px;">x</p>')).toBe(32);
  });

  it('falls back to default when absent', () => {
    expect(extractDominantFontSizePx('<p>x</p>')).toBe(20);
    expect(extractDominantFontSizePx('<p>x</p>', 16)).toBe(16);
  });
});

describe('extractDominantColor', () => {
  it('reads inline color but ignores background-color', () => {
    expect(extractDominantColor('<p style="color: #ff0000;">x</p>', '#000')).toBe('#ff0000');
  });

  it('ignores background-color when no plain color is present', () => {
    expect(extractDominantColor('<p style="background-color: #ff0000;">x</p>', '#333333')).toBe('#333333');
  });

  it('falls back when no color present', () => {
    expect(extractDominantColor('<p>x</p>', '#333333')).toBe('#333333');
  });
});

describe('planSceneHandwriting', () => {
  it('routes cued text elements to trigger "cue" with zero delay', () => {
    const elements = [textEl('a', '<p>Hello</p>')];
    const actions: Action[] = [speech('intro'), spotlight('a'), speech('outro')];
    const plan = planSceneHandwriting(elements, actions);
    expect(plan.byElementId.a).toMatchObject({ trigger: 'cue', delayMs: 0, mode: 'vara' });
  });

  it('routes uncued text elements to sequential slide-start writes', () => {
    const elements = [textEl('a', 'first'), textEl('b', 'second')];
    const plan = planSceneHandwriting(elements, []);
    expect(plan.byElementId.a.trigger).toBe('slide-start');
    expect(plan.byElementId.b.trigger).toBe('slide-start');
    expect(plan.byElementId.a.delayMs).toBe(0);
    // b starts after a's duration + one stagger gap
    expect(plan.byElementId.b.delayMs).toBe(plan.byElementId.a.durationMs + HANDWRITING_STAGGER_MS);
  });

  it('first spotlight cue wins if an element is targeted more than once', () => {
    const elements = [textEl('a', 'hello')];
    const actions: Action[] = [spotlight('a'), spotlight('a')];
    const plan = planSceneHandwriting(elements, actions);
    expect(plan.entries).toHaveLength(1);
    expect(plan.byElementId.a.trigger).toBe('cue');
  });

  it('ignores spotlights targeting non-text elements', () => {
    const elements = [textEl('a', 'hello')];
    const actions: Action[] = [spotlight('shape-1')];
    const plan = planSceneHandwriting(elements, actions);
    expect(plan.byElementId.a.trigger).toBe('slide-start');
  });

  it('skips non-text elements entirely', () => {
    const elements = [textEl('a', 'hello')];
    const plan = planSceneHandwriting(elements, []);
    expect(plan.entries).toHaveLength(1);
  });

  it('returns an empty plan for scenes with no text elements', () => {
    expect(planSceneHandwriting([], [])).toEqual({ entries: [], byElementId: {} });
  });

  it('routes CJK and rich content to wipe mode with the right cursive font', () => {
    const elements = [textEl('a', '<p>你好</p>'), textEl('b', '<ul><li>x</li></ul>')];
    const plan = planSceneHandwriting(elements, []);
    expect(plan.byElementId.a).toMatchObject({ mode: 'wipe', cursiveFontFamily: 'LXGW WenKai' });
    expect(plan.byElementId.b).toMatchObject({ mode: 'wipe', cursiveFontFamily: 'Caveat' });
  });

  it('is deterministic given the same inputs', () => {
    const elements = [textEl('a', 'first'), textEl('b', 'second'), textEl('c', 'third')];
    const actions: Action[] = [spotlight('b')];
    const plan1 = planSceneHandwriting(elements, actions);
    const plan2 = planSceneHandwriting(elements, actions);
    expect(plan1).toEqual(plan2);
  });
});
