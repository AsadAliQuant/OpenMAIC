/**
 * Handwriting reveal plan — the shared spec for "tutor writes on the slide".
 *
 * Slide text is hidden until it is written in with an animated cursive
 * stroke (`vara` mode, Latin plain text) or a clip-path wipe reveal in a
 * cursive webfont (`wipe` mode, everything Vara can't stroke: CJK, bullet
 * lists, KaTeX, tables, images). Text targeted by a `spotlight` cue writes in
 * exactly when that cue fires (spotlight timing already syncs to narration);
 * text with no cue writes in sequentially at slide start.
 *
 * Pure: text/markup inspection only via regex (no DOM, no `document`), so
 * both the live app runtime and the (pure-Node) video exporter compute the
 * identical plan from the identical scene data and cannot drift.
 */
import type { Action, PPTElement } from '@openmaic/dsl';
import { isTextElement } from '@openmaic/dsl';
import { CJK_REGEX, HANDWRITING_STAGGER_MS, estimateHandwritingDurationMs } from './timing';

export type HandwritingMode = 'vara' | 'wipe';
export type HandwritingTrigger = 'cue' | 'slide-start';

export interface HandwritingPlanEntry {
  elementId: string;
  mode: HandwritingMode;
  trigger: HandwritingTrigger;
  /** slide-start: offset (ms) from scene start. cue: always 0 (starts when the cue fires). */
  delayMs: number;
  durationMs: number;
  /** vara mode: plain-text lines (paragraph/br/li boundaries), stroked in order. */
  lines: string[];
  /** wipe mode: cursive font override, or null to keep the element's authored styling. */
  cursiveFontFamily: string | null;
}

export interface HandwritingPlan {
  entries: HandwritingPlanEntry[];
  byElementId: Record<string, HandwritingPlanEntry>;
}

const EMPTY_PLAN: HandwritingPlan = { entries: [], byElementId: {} };

/** Non-global copy of {@link CJK_REGEX} for `.test()` (safe to call repeatedly). */
const CJK_CHAR_TEST = new RegExp(CJK_REGEX.source);

/** Markup Vara cannot stroke as plain text: lists, tables, images, KaTeX. */
const RICH_MARKUP_REGEX = /<(ul|ol|table|img|svg)[\s>]|class="[^"]*katex[^"]*"/i;

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(?:nbsp|amp|lt|gt|quot|#39|apos);/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m);
}

/**
 * Extract plain-text lines from slide-element HTML, splitting on block
 * boundaries (`<br>`, `</p>`, `</div>`, `</li>`, `</h1-6>`) and stripping the
 * rest of the markup. Used both to feed Vara (one stroked line per text line)
 * and to test content for handwriting eligibility.
 */
export function extractTextLines(html: string): string[] {
  if (!html) return [];
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  const decoded = decodeHtmlEntities(withBreaks);
  return decoded
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

/**
 * Whether this HTML can be stroked by Vara as plain cursive text: no rich
 * markup (lists/tables/images/KaTeX) and no non-Latin (CJK) characters —
 * Vara's stroke font has no glyphs for either.
 */
export function isVaraWritable(html: string): boolean {
  if (!html || RICH_MARKUP_REGEX.test(html)) return false;
  const text = extractTextLines(html).join(' ');
  if (!text) return false;
  return !CJK_CHAR_TEST.test(text);
}

/**
 * Cursive font override for `wipe`-mode content: CJK routes to the
 * already-shipped `LXGW WenKai` (handwriting-style CJK font); plain Latin
 * rich text (bullets, bold, etc.) routes to `Caveat`; content with KaTeX,
 * tables, or images keeps its authored styling (`null`) — overriding the
 * font there would break math/table layout.
 */
export function cursiveFallbackFor(html: string): string | null {
  if (!html) return null;
  const text = extractTextLines(html).join(' ');
  if (CJK_CHAR_TEST.test(text)) return 'LXGW WenKai';
  if (/<(table|img|svg)[\s>]|class="[^"]*katex[^"]*"/i.test(html)) return null;
  return 'Caveat';
}

/** Strip inline `font-family` declarations so a cursive override can win. */
export function stripInlineFontFamilies(html: string): string {
  return (html || '').replace(/font-family\s*:\s*[^;"']+;?/gi, '');
}

/** First inline `font-size` (px) found in the HTML, or `fallback` (default 20). */
export function extractDominantFontSizePx(html: string, fallback = 20): number {
  const match = html && html.match(/font-size\s*:\s*([\d.]+)px/i);
  if (match) {
    const size = parseFloat(match[1]);
    if (Number.isFinite(size) && size > 0) return size;
  }
  return fallback;
}

/**
 * First inline `color` (not `background-color`) found in the HTML, or
 * `fallback`.
 */
export function extractDominantColor(html: string, fallback: string): string {
  const match = html && html.match(/(?:^|;|")\s*color\s*:\s*([^;"']+)/i);
  const color = match?.[1]?.trim();
  return color || fallback;
}

interface HandwritingElementInput {
  id: string;
  content: string;
  defaultColor: string;
}

function toHandwritingInput(el: PPTElement): HandwritingElementInput | null {
  if (!isTextElement(el)) return null;
  return { id: el.id, content: el.content ?? '', defaultColor: el.defaultColor };
}

function planEntry(
  input: HandwritingElementInput,
  trigger: HandwritingTrigger,
  delayMs: number,
): HandwritingPlanEntry {
  const vara = isVaraWritable(input.content);
  const lines = vara ? extractTextLines(input.content) : [];
  const durationMs = estimateHandwritingDurationMs(lines.join(' ') || input.content);
  return {
    elementId: input.id,
    mode: vara ? 'vara' : 'wipe',
    trigger,
    delayMs,
    durationMs,
    lines,
    cursiveFontFamily: vara ? null : cursiveFallbackFor(input.content),
  };
}

/**
 * Compute the handwriting plan for one scene: which text elements are cued
 * by a `spotlight` action (write in when that cue fires) vs. uncued (write
 * in sequentially at slide start, in element order), and each one's mode,
 * duration, and content.
 */
export function planSceneHandwriting(
  elements: ReadonlyArray<PPTElement>,
  actions: ReadonlyArray<Action>,
): HandwritingPlan {
  const textElements = elements.map(toHandwritingInput).filter((el): el is HandwritingElementInput => el !== null);
  if (textElements.length === 0) return EMPTY_PLAN;

  const textElementIds = new Set(textElements.map((el) => el.id));
  const cuedIds = new Set<string>();
  for (const action of actions) {
    if (action.type === 'spotlight' && textElementIds.has(action.elementId)) {
      cuedIds.add(action.elementId);
    }
  }

  const entries: HandwritingPlanEntry[] = [];
  let slideStartOffsetMs = 0;
  let slideStartIndex = 0;

  for (const el of textElements) {
    if (cuedIds.has(el.id)) {
      entries.push(planEntry(el, 'cue', 0));
      continue;
    }
    const delayMs = slideStartOffsetMs + slideStartIndex * HANDWRITING_STAGGER_MS;
    const entry = planEntry(el, 'slide-start', delayMs);
    entries.push(entry);
    slideStartOffsetMs += entry.durationMs;
    slideStartIndex += 1;
  }

  const byElementId: Record<string, HandwritingPlanEntry> = {};
  for (const entry of entries) byElementId[entry.elementId] = entry;
  return { entries, byElementId };
}
