/**
 * Timing spec — the single source of truth for playback timing.
 *
 * These constants and the no-audio narration estimate were previously inlined
 * in the app engines (`lib/action/engine.ts`, `lib/playback/engine.ts`). They
 * are moved here verbatim so the app runtime and the video exporter interpret
 * the same numbers: if either side re-implemented them, the exported video
 * would silently drift whenever the app is tuned. The literals below are the
 * behavior-defining values — change them here and both consumers follow.
 *
 * Pure: depends on nothing (no React / DOM / render backend), so it can be
 * interpreted in a pure Node environment by the exporter.
 */

// ==================== Effect / scene timing ====================

/** Duration (ms) a fire-and-forget effect (spotlight/laser) stays before auto-clearing. */
export const EFFECT_AUTO_CLEAR_MS = 5000;

/** Delay (ms) before a discussion trigger shows its ProactiveCard (lets prior speech finish). */
export const DISCUSSION_TRIGGER_DELAY_MS = 3000;

/**
 * Duration (ms) the ProactiveCard counts down in playback mode before it
 * auto-skips and playback continues. In unattended playback / export a
 * non-skipped discussion therefore blocks for
 * `DISCUSSION_TRIGGER_DELAY_MS + DISCUSSION_AUTO_SKIP_MS`. The `ProactiveCard`
 * component reads this same constant, so the card countdown and the timeline
 * can't drift.
 */
export const DISCUSSION_AUTO_SKIP_MS = 5000;

/** Safety cap (ms) on how long playback waits for a video to finish. */
export const MAX_VIDEO_WAIT_MS = 5 * 60 * 1000;

// ==================== Whiteboard / widget action durations ====================
//
// The blocking "visual duration" of each synchronous action — how long the
// engine awaits before advancing to the next action. Lifted verbatim from the
// `delay(...)` call sites in `lib/action/engine.ts`.

/** wb_open — open animation (slow spring). */
export const WB_OPEN_MS = 2000;

/** wb_draw_* (text/shape/chart/latex/table/line) — element fade-in. */
export const WB_DRAW_MS = 800;

/** wb_edit_code — line-level edit animation. */
export const WB_EDIT_MS = 600;

/** wb_delete — element removal. */
export const WB_DELETE_MS = 300;

/** wb_close — close animation (ease-out tween). */
export const WB_CLOSE_MS = 700;

/** widget_* interactions (highlight/setState/annotation/reveal). */
export const WIDGET_MS = 300;

/**
 * wb_draw_code — typing animation: base 800ms + 50ms/line, capped at 3000ms.
 * Verbatim from `lib/action/engine.ts` (`Math.min(800 + lines.length * 50, 3000)`).
 */
export function wbDrawCodeMs(lineCount: number): number {
  return Math.min(800 + lineCount * 50, 3000);
}

/**
 * wb_clear — clear animation: base 380ms + 55ms/element, capped at 1400ms.
 * Verbatim from `lib/action/engine.ts` (`Math.min(380 + elementCount * 55, 1400)`).
 */
export function wbClearMs(elementCount: number): number {
  return Math.min(380 + elementCount * 55, 1400);
}

// ==================== No-audio narration estimate ====================

/**
 * Characters counted as CJK for the reading-timer heuristic: CJK Unified
 * Ideographs (+ Ext-A), Hiragana, Katakana, Hangul Syllables. Verbatim from the
 * regex in `lib/playback/engine.ts`'s `scheduleReadingTimer`.
 */
export const CJK_REGEX = /[一-鿿㐀-䶿぀-ゟ゠-ヿ가-힯]/g;

/** Text is treated as CJK when this fraction of its characters are CJK. */
const CJK_RATIO_THRESHOLD = 0.3;

/** Minimum estimated reading time (ms), regardless of length. */
const MIN_READING_MS = 2000;

/** CJK narration pace: ms per character (one char ≈ one word). */
const CJK_MS_PER_CHAR = 150;

/** Non-CJK narration pace: ms per word (≈250 WPM). */
const NON_CJK_MS_PER_WORD = 240;

export interface SpeechEstimateOptions {
  /** Playback speed multiplier; the estimate is divided by it. Default 1. */
  speed?: number;
}

/**
 * Estimate how long narration takes to "speak" when no pre-generated audio is
 * available (TTS disabled). Deterministic — the exporter and the app's
 * reading-timer must agree on the dwell of an audio-less speech clip.
 *
 * - CJK text (>30% CJK chars): ~150ms/char.
 * - Non-CJK text: ~240ms/word (≈250 WPM).
 * - Floored at 2000ms, then divided by playback speed.
 *
 * Moved verbatim from `lib/playback/engine.ts`'s `scheduleReadingTimer`.
 */
export function estimateSpeechDurationMs(text: string, opts?: SpeechEstimateOptions): number {
  const speed = opts?.speed ?? 1;
  const cjkCount = (text.match(CJK_REGEX) || []).length;
  const isCJK = cjkCount > text.length * CJK_RATIO_THRESHOLD;
  const rawMs = isCJK
    ? Math.max(MIN_READING_MS, text.length * CJK_MS_PER_CHAR)
    : Math.max(MIN_READING_MS, text.split(/\s+/).filter(Boolean).length * NON_CJK_MS_PER_WORD);
  return rawMs / speed;
}

// ==================== Handwriting reveal timing ====================
//
// Shared by the live "tutor writes on the slide" reveal (app runtime) and its
// video-export reproduction. A cue-triggered write must finish inside the
// spotlight window that triggers it, so `HANDWRITING_MAX_MS` is kept strictly
// below `EFFECT_AUTO_CLEAR_MS` — this is a correctness invariant, not a taste
// choice: a write that outlived its spotlight's auto-clear would visually
// "pop" the rest of the text in in the app but not in an export built on the
// same clamp, or vice versa.

/** Pace of the handwriting reveal: ms of write time per character. */
export const HANDWRITING_MS_PER_CHAR = 90;

/** Floor on a single element's write duration (ms), regardless of length. */
export const HANDWRITING_MIN_MS = 1200;

/**
 * Ceiling on a single element's write duration (ms). Must stay strictly below
 * `EFFECT_AUTO_CLEAR_MS` so a cue-triggered write always completes while its
 * triggering spotlight is still up.
 */
export const HANDWRITING_MAX_MS = 4500;

/** Gap (ms) between consecutive slide-start writes in the sequential queue. */
export const HANDWRITING_STAGGER_MS = 250;

/**
 * Estimate how long a handwriting write-in should take, proportional to
 * text length and clamped to `[HANDWRITING_MIN_MS, HANDWRITING_MAX_MS]`.
 */
export function estimateHandwritingDurationMs(text: string): number {
  return Math.min(
    HANDWRITING_MAX_MS,
    Math.max(HANDWRITING_MIN_MS, text.length * HANDWRITING_MS_PER_CHAR),
  );
}
