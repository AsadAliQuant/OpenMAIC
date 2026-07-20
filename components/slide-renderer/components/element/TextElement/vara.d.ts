/**
 * Minimal ambient types for `vara` (npm `vara@1.4.1`) — it ships no `.d.ts`.
 * Only the constructor options and callbacks the handwriting reveal actually
 * uses; see `node_modules/vara/src/vara.js` for the full (untyped) surface.
 */
declare module 'vara' {
  export interface VaraText {
    text: string;
    id?: string | number;
    /** Stroke duration (ms) for this text entry. Falls back to `VaraOptions.duration` (default 2000). */
    duration?: number;
    /** When true (default), this entry starts after the previous queued entry finishes. */
    queued?: boolean;
    delay?: number;
    color?: string;
    fontSize?: number;
    strokeWidth?: number;
    textAlign?: 'left' | 'center' | 'right';
  }

  export interface VaraOptions {
    fontSize?: number;
    strokeWidth?: number;
    color?: string;
    duration?: number;
    textAlign?: 'left' | 'center' | 'right';
    lineHeight?: number;
    letterSpacing?: number;
    /** When false, strokes wait for an explicit `draw()` call instead of animating on load. */
    autoAnimation?: boolean;
    breakWord?: boolean;
  }

  export default class Vara {
    constructor(elementSelector: string, fontSource: string, text: string | VaraText[], properties?: VaraOptions);
    /** Registers a callback fired once the font JSON has loaded and strokes are ready to animate. */
    ready(callback: () => void): void;
    /**
     * Registers a callback fired once **per text entry** as its stroke
     * finishes (not once for the whole instance) — `id` is the entry's
     * `VaraText.id`, defaulting to its index in the `text` array passed to
     * the constructor. To detect "all entries done", compare `id` against
     * the last index.
     */
    animationEnd(callback: (id: string | number, drawnCharacters: unknown) => void): void;
    /** Starts (or restarts) the stroke animation for a specific text entry id (default: draw all). */
    draw(id?: string | number, duration?: number): void;
    get(id: string | number): unknown;
  }
}
