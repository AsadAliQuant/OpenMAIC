/**
 * Shared text formatting for the Hyperframes emitter: HTML escaping and the
 * ms→seconds conversion used by both the composition HTML ({@link ./index}) and
 * the effect tweens ({@link ./effects}). One definition each so the two layers
 * can't drift — e.g. two escapers with different rule sets emitting into the same
 * document, or two `sec` helpers with different rounding.
 *
 * Pure: string/number formatting only.
 */

/**
 * Escape a string for embedding in HTML text or a double-quoted attribute value.
 * Covers `& < > "` — the full set, so it is safe for both element text and
 * attribute values (colors, asset URLs, titles, diagnostic reasons).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Millisecond offset → seconds on the composition clock, trimmed to 4 decimals. */
export function sec(ms: number): number {
  return Number((ms / 1000).toFixed(4));
}

/**
 * Directory the collected binary assets live under in the export zip. The
 * compiler's asset plan uses bare paths (`frames/…`, `audio/…`, `media/…`); the
 * project places them all under `assets/` (matching the artifact layout and the
 * vendored GSAP at `assets/vendor/`). The packaging layer writes each plan blob
 * at this same `assets/<planPath>`, so HTML references and zip entries agree.
 */
export const ASSETS_DIR = 'assets';

/** Map a compiler asset-plan path to its zip-relative URL under `assets/`. */
export function assetUrl(planPath: string): string {
  return `${ASSETS_DIR}/${planPath}`;
}
