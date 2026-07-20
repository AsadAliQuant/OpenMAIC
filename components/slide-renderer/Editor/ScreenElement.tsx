'use client';

import { ElementTypes, type PPTElement } from '@openmaic/dsl';
import { useMemo } from 'react';

import { BaseImageElement } from '../components/element/ImageElement/BaseImageElement';
import { BaseTextElement } from '../components/element/TextElement/BaseTextElement';
import { HandwritingTextElement } from '../components/element/TextElement/HandwritingTextElement';
import { BaseShapeElement } from '../components/element/ShapeElement/BaseShapeElement';
import { BaseLineElement } from '../components/element/LineElement/BaseLineElement';
import { BaseChartElement } from '../components/element/ChartElement/BaseChartElement';
import { BaseLatexElement } from '../components/element/LatexElement/BaseLatexElement';
import { BaseTableElement } from '../components/element/TableElement/BaseTableElement';
import { BaseVideoElement } from '../components/element/VideoElement/BaseVideoElement';
import { BaseCodeElement } from '../components/element/CodeElement/BaseCodeElement';
import { useSceneSelector } from '@/lib/contexts/scene-context';
import type { SceneContent } from '@/lib/types/stage';
import { useCanvasStore } from '@/lib/store';

interface ScreenElementProps {
  readonly elementInfo: PPTElement;
  readonly elementIndex: number;
  readonly animate?: boolean;
}

export function ScreenElement({ elementInfo, elementIndex, animate }: ScreenElementProps) {
  // Only populated during playback (`ActionEngine.beginSceneHandwriting`);
  // the editor canvas never sets this, so it never affects editing.
  const handwritingEntry = useCanvasStore.use.handwritingPlan()?.[elementInfo.id];

  const CurrentElementComponent = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- element components have varying prop signatures
    const elementTypeMap: Record<string, any> = {
      [ElementTypes.IMAGE]: BaseImageElement,
      [ElementTypes.TEXT]: BaseTextElement,
      [ElementTypes.SHAPE]: BaseShapeElement,
      [ElementTypes.LINE]: BaseLineElement,
      [ElementTypes.CHART]: BaseChartElement,
      [ElementTypes.LATEX]: BaseLatexElement,
      [ElementTypes.TABLE]: BaseTableElement,
      [ElementTypes.VIDEO]: BaseVideoElement,
      [ElementTypes.CODE]: BaseCodeElement,
      // TODO: Add other element types
      // [ElementTypes.AUDIO]: BaseAudioElement,
    };
    return elementTypeMap[elementInfo.type] || null;
  }, [elementInfo.type]);

  const theme = useSceneSelector<SceneContent, { fontColor: string; fontName: string }>(
    (content) => {
      if (content.type === 'slide') {
        return content.canvas.theme;
      }
      return {
        fontColor: '#333333',
        fontName: 'Microsoft YaHei',
      };
    },
  );

  if (elementInfo.type === ElementTypes.TEXT && handwritingEntry) {
    return (
      <div
        className="screen-element"
        id={`screen-element-${elementInfo.id}`}
        style={{
          zIndex: elementIndex,
          color: theme.fontColor,
          fontFamily: theme.fontName,
        }}
      >
        <HandwritingTextElement elementInfo={elementInfo} entry={handwritingEntry} />
      </div>
    );
  }

  if (!CurrentElementComponent) {
    return null;
  }

  return (
    <div
      className="screen-element"
      id={`screen-element-${elementInfo.id}`}
      style={{
        zIndex: elementIndex,
        color: theme.fontColor,
        fontFamily: theme.fontName,
      }}
    >
      <CurrentElementComponent elementInfo={elementInfo} animate={animate} />
    </div>
  );
}
