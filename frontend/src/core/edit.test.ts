import { describe, expect, it } from 'vitest';
import { assertProject, changeSpeed, deleteClip, moveClip, rippleGap, snapFrame, splitClip, trimClip } from './edit';
import { createProject, DEFAULT_CROP, DEFAULT_TRANSFORM, type Clip } from './types';

const fixture = () => {
  const project = createProject(); project.export.fps = 30;
  const clip: Clip = { id: 'c1', mediaId: 'm1', sourceStart: 0, sourceEnd: 6, timelineStart: 1, speed: 1, crop: { ...DEFAULT_CROP }, transform: { ...DEFAULT_TRANSFORM }, audio: { enabled: true, volume: 1 } };
  project.tracks[0].clips = [clip]; return project;
};

describe('Project v1 순수 편집 명령', () => {
  it('프레임 경계에 스냅한다', () => expect(snapFrame(1.02, 30)).toBe(1 + 1 / 30));
  it('왼쪽 트림이 소스와 타임라인 시작을 함께 이동한다', () => {
    const next = trimClip(fixture(), 'c1', 'start', 1); expect(next.tracks[0].clips[0]).toMatchObject({ sourceStart: 1, timelineStart: 2 }); expect(assertProject(next)).toBe(true);
  });
  it('재생 헤드에서 손실 없이 분할한다', () => {
    const next = splitClip(fixture(), 'c1', 3); const clips = next.tracks[0].clips;
    expect(clips).toHaveLength(2); expect(clips[0].sourceEnd).toBe(clips[1].sourceStart); expect(clips[1].timelineStart).toBe(3);
  });
  it('이동, 삭제, 속도 변경은 원본을 변경하지 않는다', () => {
    const original = fixture(); const moved = moveClip(original, 'c1', 2.02);
    expect(original.tracks[0].clips[0].timelineStart).toBe(1); expect(moved.tracks[0].clips[0].timelineStart).toBe(2 + 1 / 30);
    expect(changeSpeed(moved, 'c1', 99).tracks[0].clips[0].speed).toBe(16); expect(deleteClip(moved, 'c1').tracks[0].clips).toHaveLength(0);
  });
  it('선택 트랙의 갭만 프레임 단위로 닫는다', () => {
    const project = fixture(); project.tracks[0].clips.push({ ...structuredClone(project.tracks[0].clips[0]), id: 'c2', timelineStart: 10 });
    const next = rippleGap(project, project.tracks[0].id); expect(next.tracks[0].clips.map((c) => c.timelineStart)).toEqual([0, 6]);
  });
  it('정규화 크롭 불변식을 거부한다', () => {
    const project = fixture(); project.tracks[0].clips[0].crop.width = 2; expect(() => assertProject(project)).toThrow('잘못된 크롭');
  });
});
