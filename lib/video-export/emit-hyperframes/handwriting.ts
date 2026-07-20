/**
 * Handwriting emission — an IR {@link HandwritingSegment} → the overlay HTML and
 * GSAP statements that reproduce a "tutor writes on the slide" write-in at
 * render time.
 *
 * Every segment, `vara` and `wipe` alike, emits the **same** deterministic
 * clip-path wipe over a pre-rendered overlay frame (`assetRef` — the element
 * snapshotted in isolation, cursive font applied where safe; see the
 * `assets` pass and the collector). This is a deliberate export-only
 * simplification, not a gap in the plan: live playback strokes `vara`-mode
 * text with a real Vara.js instance (see `HandwritingTextElement`), but
 * reproducing that in the exported composition would mean instantiating
 * Vara.js at render time — it fetches its font JSON via its own XHR, which
 * conflicts with the composition's "no network at render time" determinism
 * contract (`emitHyperframes`'s doc comment), and its `ready()` callback has
 * no guaranteed ordering against Hyperframes' first captured frame. A
 * pre-rendered frame + wipe has neither problem and matches how the base
 * slide frame itself is already produced (a deterministic snapshot, not a
 * live DOM).
 *
 * The base slide-snapshot frame excludes every element with a handwriting
 * segment (see the collector), so this overlay is the only place that
 * element's text ever renders in the export.
 *
 * Pure: string generation only; depends on the IR types.
 */
import type { HandwritingSegment } from '../ir';
import { EASE_IN_OUT_ID } from './effects';
import { assetUrl, escapeHtml, sec } from './format';

/** One emitted handwriting segment: the DOM to place in the stage and the tweens to add to `tl`. */
export interface EmittedHandwriting {
  html: string;
  statements: string[];
}

/** Format a number for HTML/JS output: trimmed to 4 decimals, no exponent. */
function n(value: number): string {
  return Number(value.toFixed(4)).toString();
}

/**
 * Emit one handwriting segment as a positioned `<img>` overlay of the
 * pre-rendered element frame, revealed left-to-right via an animated
 * `clip-path: inset()` (matches the live `wipe`-mode reveal in
 * `HandwritingTextElement`). Once fully revealed it stays visible for the
 * rest of the composition — "stays cursive", no exit fade.
 *
 * No output for a degraded segment (unresolved geometry) or one with no
 * planned overlay asset — the base frame still renders (sans that element's
 * text), matching the compiler's degrade-on-miss contract elsewhere.
 */
export function emitHandwriting(seg: HandwritingSegment, id: string): EmittedHandwriting {
  if (seg.degraded || !seg.geometry || !seg.assetRef) return { html: '', statements: [] };
  const g = seg.geometry;

  const start = sec(seg.startMs);
  const end = sec(seg.startMs + seg.durationMs);
  const rotate = seg.rotate ? ` rotate(${n(seg.rotate)}deg)` : '';

  const html = `<img id="${id}" class="fx fx-handwriting" src="${escapeHtml(assetUrl(seg.assetRef))}" alt="" style="position:absolute;z-index:10;left:${n(g.x)}%;top:${n(g.y)}%;width:${n(g.w)}%;height:${n(g.h)}%;transform:${rotate || 'none'};visibility:hidden;opacity:0;clip-path:inset(0 100% 0 0)" />`;

  const statements = [
    `tl.set('#${id}',{autoAlpha:1},${n(start)});`,
    `tl.fromTo('#${id}',{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0% 0 0)',duration:${n(end - start)},ease:${EASE_IN_OUT_ID}},${n(start)});`,
  ];
  return { html, statements };
}
