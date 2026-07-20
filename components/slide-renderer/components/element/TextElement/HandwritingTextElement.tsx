'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { PPTTextElement } from '@openmaic/dsl';
import { useCanvasStore } from '@/lib/store';
import type { HandwritingPlanEntry } from '@/lib/choreography';
import {
  extractDominantFontSizePx,
  extractDominantColor,
  stripInlineFontFamilies,
} from '@/lib/choreography';
import { useElementShadow } from '../hooks/useElementShadow';
import { ElementOutline } from '../ElementOutline';

export interface HandwritingTextElementProps {
  elementInfo: PPTTextElement;
  entry: HandwritingPlanEntry;
}

type Phase = 'hidden' | 'writing' | 'done';

const VARA_FONT_URL = '/vendor/vara/SatisfySL.json';

/**
 * Playback-only text renderer for elements the "tutor writes on the slide"
 * reveal manages (see `lib/choreography/handwriting.ts`). Text starts
 * invisible and writes in — a real pen stroke via Vara.js for plain Latin
 * content (`entry.mode === 'vara'`), or a left-to-right clip-path wipe in a
 * cursive webfont for everything Vara can't stroke (CJK, lists, KaTeX,
 * tables). Swapped in for `BaseTextElement` by `ScreenElement` only while a
 * handwriting plan exists for this element — the slide editor never
 * populates that plan, so its canvas is unaffected.
 *
 * The outer box/rotate-wrapper/`.element-content` structure mirrors
 * `BaseTextElement` exactly, and — unlike it — pins `.element-content` to
 * `elementInfo.width/height` in every phase rather than sizing to content:
 * `SpotlightOverlay` measures `.element-content` the instant a cue-triggered
 * write starts (before any stroke/wipe content exists), so the box must
 * already be at its final size for the spotlight cutout to land correctly.
 */
export function HandwritingTextElement({ elementInfo, entry }: HandwritingTextElementProps) {
  const { shadowStyle } = useElementShadow(elementInfo.shadow);
  const startHandwriting = useCanvasStore.use.startHandwriting();
  const startedAt = useCanvasStore.use.handwritingStarted()[elementInfo.id];
  const sceneStartedAt = useCanvasStore.use.handwritingSceneStartedAt();

  // `written` is the only true local state — everything else about `phase`
  // is derived from the store (`startedAt`) so there is no effect mirroring
  // external state into local state.
  const [written, setWritten] = useState(false);
  const phase: Phase = written ? 'done' : startedAt !== undefined ? 'writing' : 'hidden';
  const varaContainerId = `hw-vara-${elementInfo.id}`;

  // Slide-start entries own scheduling their own write; cue entries are
  // started externally by `ActionEngine.executeSpotlight`.
  useEffect(() => {
    if (entry.trigger !== 'slide-start' || startedAt !== undefined) return;
    const remainingMs = entry.delayMs - (performance.now() - sceneStartedAt);
    const timer = setTimeout(() => startHandwriting(elementInfo.id), Math.max(0, remainingMs));
    return () => clearTimeout(timer);
  }, [entry.trigger, entry.delayMs, sceneStartedAt, startedAt, elementInfo.id, startHandwriting]);

  const varaReady = useVaraStroke({
    active: phase === 'writing' && entry.mode === 'vara',
    containerId: varaContainerId,
    lines: entry.lines,
    durationMs: entry.durationMs,
    fontSize: extractDominantFontSizePx(elementInfo.content),
    color: extractDominantColor(elementInfo.content, elementInfo.defaultColor),
    onDone: () => setWritten(true),
  });

  return (
    <div
      className="base-element-text absolute"
      style={{
        top: `${elementInfo.top}px`,
        left: `${elementInfo.left}px`,
        width: `${elementInfo.width}px`,
        height: `${elementInfo.height}px`,
      }}
    >
      <div
        className="rotate-wrapper w-full h-full"
        style={{
          transform: `rotate(${elementInfo.rotate}deg)`,
          backgroundColor: elementInfo.fill,
          opacity: elementInfo.opacity,
        }}
      >
        <div
          className="element-content relative p-[10px] leading-[1.5] break-words"
          style={{
            // Pinned (not 'auto') in every phase — see component doc comment.
            width: `${elementInfo.width}px`,
            height: `${elementInfo.height}px`,
            textShadow: shadowStyle,
            lineHeight: elementInfo.lineHeight,
            letterSpacing: `${elementInfo.wordSpace || 0}px`,
            color: elementInfo.defaultColor,
            fontFamily: elementInfo.defaultFontName,
            writingMode: elementInfo.vertical ? 'vertical-rl' : 'horizontal-tb',
            // @ts-expect-error - CSS custom property
            '--paragraphSpace': `${elementInfo.paragraphSpace === undefined ? 5 : elementInfo.paragraphSpace}px`,
          }}
        >
          <ElementOutline
            width={elementInfo.width}
            height={elementInfo.height}
            outline={elementInfo.outline}
          />
          {entry.mode === 'vara' ? (
            <div
              id={varaContainerId}
              className="handwriting-vara relative"
              style={{ opacity: varaReady ? 1 : 0 }}
            />
          ) : (
            <WipeReveal elementInfo={elementInfo} entry={entry} phase={phase} onDone={() => setWritten(true)} />
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== Vara stroke mode ====================

interface UseVaraStrokeOptions {
  active: boolean;
  containerId: string;
  lines: string[];
  durationMs: number;
  fontSize: number;
  color: string;
  onDone: () => void;
}

/** Mounts a Vara instance into `#containerId` once `active`; returns whether it has started stroking (container has content worth showing). */
function useVaraStroke({
  active,
  containerId,
  lines,
  durationMs,
  fontSize,
  color,
  onDone,
}: UseVaraStrokeOptions): boolean {
  const [ready, setReady] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!active || lines.length === 0) return;
    let cancelled = false;

    import('vara').then(({ default: Vara }) => {
      if (cancelled || !document.getElementById(containerId)) return;
      const perLineMs = durationMs / lines.length;
      const vara = new Vara(
        `#${containerId}`,
        VARA_FONT_URL,
        lines.map((text) => ({ text, duration: perLineMs, queued: true })),
        { fontSize, color, strokeWidth: 1.5, textAlign: 'left' },
      );
      vara.ready(() => {
        if (!cancelled) setReady(true);
      });
      // Fires once per queued text entry (line) — only the last line's
      // completion means the whole element is done.
      const lastLineId = lines.length - 1;
      vara.animationEnd((id) => {
        if (!cancelled && id === lastLineId) onDoneRef.current();
      });
    });

    return () => {
      cancelled = true;
    };
    // `lines`/`fontSize`/`color` are derived once per element from its (static,
    // read-only during playback) content — re-running on their identity change
    // is intentionally excluded to avoid remounting Vara mid-stroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, containerId, durationMs]);

  return ready;
}

// ==================== Wipe fallback mode ====================

interface WipeRevealProps {
  elementInfo: PPTTextElement;
  entry: HandwritingPlanEntry;
  phase: Phase;
  onDone: () => void;
}

/** Left-to-right clip-path reveal for content Vara can't stroke (CJK, lists, KaTeX, tables). */
function WipeReveal({ elementInfo, entry, phase, onDone }: WipeRevealProps) {
  const content = entry.cursiveFontFamily
    ? stripInlineFontFamilies(elementInfo.content)
    : elementInfo.content;

  return (
    <motion.div
      className="text ProseMirror-static relative"
      style={{ fontFamily: entry.cursiveFontFamily ?? elementInfo.defaultFontName }}
      initial={false}
      animate={{ clipPath: phase === 'hidden' ? 'inset(0 100% 0 0)' : 'inset(0 0% 0 0)' }}
      transition={{ duration: entry.durationMs / 1000, ease: 'easeInOut' }}
      onAnimationComplete={() => {
        if (phase === 'writing') onDone();
      }}
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}
