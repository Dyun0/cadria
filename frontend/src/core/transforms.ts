import type { Clip } from './types';

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

/** Preview/export contract: crop → flip/rotate → scale/position. */
export function sourceToCrop(point: Point, clip: Clip): Point {
  return { x: (point.x - clip.crop.x) / clip.crop.width, y: (point.y - clip.crop.y) / clip.crop.height };
}

export function cropToStage(point: Point, clip: Clip): Point {
  let x = clip.transform.flipX ? 1 - point.x : point.x;
  let y = clip.transform.flipY ? 1 - point.y : point.y;
  switch (clip.transform.rotation) {
    case 90: [x, y] = [1 - y, x]; break;
    case 180: [x, y] = [1 - x, 1 - y]; break;
    case 270: [x, y] = [y, 1 - x]; break;
  }
  return {
    x: clip.transform.x + x * clip.transform.width * clip.transform.scale,
    y: clip.transform.y + y * clip.transform.height * clip.transform.scale,
  };
}

export const sourceToStage = (point: Point, clip: Clip) => cropToStage(sourceToCrop(point, clip), clip);

export function stageToPixels(point: Point, stage: Size): Point {
  return { x: point.x * stage.width, y: point.y * stage.height };
}

export function previewStyle(clip: Clip): Record<string, string> {
  const { crop, transform } = clip;
  return {
    left: `${transform.x * 100}%`, top: `${transform.y * 100}%`,
    width: `${transform.width * transform.scale * 100}%`,
    height: `${transform.height * transform.scale * 100}%`,
    '--video-x': `${(-crop.x / crop.width) * 100}%`,
    '--video-y': `${(-crop.y / crop.height) * 100}%`,
    '--video-w': `${100 / crop.width}%`,
    '--video-h': `${100 / crop.height}%`,
    transform: `rotate(${transform.rotation}deg) scale(${transform.flipX ? -1 : 1}, ${transform.flipY ? -1 : 1})`,
  };
}
