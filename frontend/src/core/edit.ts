import { safeUUID, type Clip, type ProjectV1, type Track } from './types';

const clone = <T,>(value: T): T => structuredClone(value);
export const snapFrame = (seconds: number, fps: number) => Math.round(seconds * fps) / fps;
export const clipDuration = (clip: Clip) => (clip.sourceEnd - clip.sourceStart) / clip.speed;
export const projectDuration = (project: ProjectV1) =>
  Math.max(0, ...project.tracks.flatMap((track) => track.clips.map((clip) => clip.timelineStart + clipDuration(clip))));

const mutateClip = (project: ProjectV1, clipId: string, fn: (clip: Clip, track: Track) => void) => {
  const next = clone(project);
  for (const track of next.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) { fn(clip, track); next.updatedAt = new Date().toISOString(); return next; }
  }
  return project;
};

export function trimClip(project: ProjectV1, clipId: string, edge: 'start' | 'end', sourceTime: number): ProjectV1 {
  return mutateClip(project, clipId, (clip) => {
    const frame = 1 / project.export.fps;
    if (edge === 'start') {
      const value = Math.min(clip.sourceEnd - frame, Math.max(0, snapFrame(sourceTime, project.export.fps)));
      clip.timelineStart = snapFrame(Math.max(0, clip.timelineStart + (value - clip.sourceStart) / clip.speed), project.export.fps);
      clip.sourceStart = value;
    } else {
      const mediaEnd = project.media[clip.mediaId]?.duration ?? Number.POSITIVE_INFINITY;
      clip.sourceEnd = Math.min(mediaEnd, Math.max(clip.sourceStart + frame, snapFrame(sourceTime, project.export.fps)));
    }
  });
}

export function splitClip(project: ProjectV1, clipId: string, at: number): ProjectV1 {
  return mutateClip(project, clipId, (clip, track) => {
    const time = snapFrame(at, project.export.fps);
    const local = time - clip.timelineStart;
    if (local <= 0 || local >= clipDuration(clip)) return;
    const source = snapFrame(clip.sourceStart + local * clip.speed, project.export.fps);
    const index = track.clips.findIndex((item) => item.id === clip.id);
    const right: Clip = { ...clone(clip), id: safeUUID(), sourceStart: source, timelineStart: time };
    clip.sourceEnd = source;
    track.clips.splice(index + 1, 0, right);
  });
}

export const moveClip = (project: ProjectV1, clipId: string, timelineStart: number, targetTrackId?: string): ProjectV1 => {
  const next = clone(project);
  let clip: Clip | undefined;
  let sourceTrackId: string | undefined;
  for (const track of next.tracks) {
    const index = track.clips.findIndex((item) => item.id === clipId);
    if (index >= 0) { [clip] = track.clips.splice(index, 1); sourceTrackId = track.id; }
  }
  const target = next.tracks.find((track) => track.id === (targetTrackId ?? sourceTrackId));
  if (!clip || !target || target.locked) return project;
  clip.timelineStart = snapFrame(Math.max(0, timelineStart), project.export.fps);
  target.clips.push(clip); target.clips.sort((a, b) => a.timelineStart - b.timelineStart);
  next.updatedAt = new Date().toISOString(); return next;
};

export const deleteClip = (project: ProjectV1, clipId: string): ProjectV1 => {
  const next = clone(project);
  next.tracks.forEach((track) => { track.clips = track.clips.filter((clip) => clip.id !== clipId); });
  next.updatedAt = new Date().toISOString(); return next;
};

export const rippleGap = (project: ProjectV1, trackId: string): ProjectV1 => {
  const next = clone(project); const track = next.tracks.find((item) => item.id === trackId);
  if (!track || track.locked) return project;
  let cursor = 0;
  track.clips.sort((a, b) => a.timelineStart - b.timelineStart).forEach((clip) => {
    clip.timelineStart = snapFrame(cursor, project.export.fps); cursor = clip.timelineStart + clipDuration(clip);
  });
  next.updatedAt = new Date().toISOString(); return next;
};

export const changeSpeed = (project: ProjectV1, clipId: string, speed: number): ProjectV1 =>
  mutateClip(project, clipId, (clip) => { clip.speed = Math.min(16, Math.max(0.1, speed)); });

export function assertProject(project: ProjectV1): true {
  if (project.version !== 1 || project.export.fps <= 0) throw new Error('지원하지 않는 프로젝트입니다.');
  for (const track of project.tracks) for (const clip of track.clips) {
    if (clip.sourceStart < 0 || clip.sourceEnd <= clip.sourceStart || clip.timelineStart < 0 || clip.speed < .1 || clip.speed > 16) throw new Error(`잘못된 클립: ${clip.id}`);
    const { crop } = clip;
    if (crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001) throw new Error(`잘못된 크롭: ${clip.id}`);
    if (clip.audio.volume < 0 || clip.audio.volume > 1) throw new Error(`잘못된 볼륨: ${clip.id}`);
  }
  return true;
}
