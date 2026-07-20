import type { AnimationDescriptor } from './types';

/**
 * handwriting.v1 — the "tutor writes on the slide" text reveal.
 *
 * Two render-time modes, both driven by the same segment timing
 * (`startMs`/`durationMs` from `HandwritingSegment`), only one of which this
 * layer/track model can express declaratively:
 *
 * - `wipe` (the fallback for content Vara can't stroke: CJK, lists, KaTeX,
 *   tables — see `lib/choreography/handwriting.ts`'s `isVaraWritable`) is a
 *   real content reveal: a left-to-right `clip-path: inset()` wipe over a
 *   pre-rendered frame of the element (isolated, cursive font applied). That
 *   is the `content` track below — `clipPathInsetRight` 100 → 0, i.e. the
 *   element starts fully clipped from the right edge and reveals to fully
 *   visible. `durationMs` is intentionally omitted: unlike spotlight/laser's
 *   fixed timings, a handwriting write's duration is per-instance (text
 *   length, clamped — `estimateHandwritingDurationMs`), carried on the
 *   `HandwritingSegment` itself; the consumer reads it from there.
 * - `vara` (plain Latin text) strokes real cursive pen paths via the
 *   vendored Vara.js font renderer — a per-character stroke-length animation
 *   the source library computes from its own font JSON, which this static
 *   track model has no vocabulary for (same category of escape hatch as
 *   spotlight's SVG-mask compositing or laser's finite-expanded ring pulse:
 *   real, but emitter-specific). Consumers render `vara` mode from the
 *   segment's `lines` directly instead of interpreting this descriptor's
 *   `content` track.
 *
 * `zIndex` sits above ordinary slide content but below the spotlight/laser
 * overlays (100/101) — a handwriting write can be legitimately spotlit while
 * it plays (the cue that triggers the write is the same spotlight).
 */
export const handwritingV1: AnimationDescriptor = {
  id: 'handwriting.v1',
  version: 1,
  effect: 'handwriting',
  params: { strokeWidth: 1.5, fontJson: 'SatisfySL' },
  zIndex: 10,
  layers: [
    {
      id: 'content',
      staticProps: { willChange: 'clip-path' },
      tracks: [
        {
          property: 'clipPathInsetRight',
          from: 100,
          to: 0,
          easing: { type: 'named', name: 'easeInOut' },
        },
      ],
    },
  ],
};
