import { describe, expect, it } from 'vitest';
import { DEFAULT_CROP, DEFAULT_TRANSFORM, type Clip } from './types';
import { sourceToCrop, sourceToStage, stageToPixels } from './transforms';

const clip: Clip = {
  id: 'c', mediaId: 'm', sourceStart: 0, sourceEnd: 1, timelineStart: 0, speed: 1,
  crop: { ...DEFAULT_CROP, x: .25, width: .5 },
  transform: { ...DEFAULT_TRANSFORM, x: .1, y: .2, width: .5, height: .5, scale: 1 },
  audio: { enabled: true, volume: 1 },
};

describe('미리보기/내보내기 좌표 계약', () => {
  it('crop → transform → pixels 순서를 유지한다', () => {
    expect(sourceToCrop({ x: .5, y: .5 }, clip)).toEqual({ x: .5, y: .5 });
    expect(sourceToStage({ x: .5, y: .5 }, clip)).toEqual({ x: .35, y: .45 });
    expect(stageToPixels({ x: .35, y: .45 }, { width: 1000, height: 500 })).toEqual({ x: 350, y: 225 });
  });
  it('flip과 rotation을 scale/position 이전에 적용한다', () => {
    const transformed = { ...clip, crop: { ...DEFAULT_CROP }, transform: { ...clip.transform, rotation: 90 as const, flipX: true } };
    const point = sourceToStage({ x: .2, y: .3 }, transformed);
    expect(point.x).toBeCloseTo(.45); expect(point.y).toBeCloseTo(.6);
  });
});
