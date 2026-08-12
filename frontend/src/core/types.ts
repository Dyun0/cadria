export type ID = string;

export interface NormalizedCrop { x: number; y: number; width: number; height: number }
export interface NormalizedTransform {
  x: number; y: number; width: number; height: number; scale: number;
  rotation: 0 | 90 | 180 | 270; flipX: boolean; flipY: boolean;
}
export interface ClipAudio { enabled: boolean; volume: number }

export interface Media {
  id: ID; name: string; originalName?: string; url: string; duration: number; width: number; height: number;
  mimeType: string; hasAudio: boolean; thumbnailUrl?: string; serverFilename?: string;
}
export interface Clip {
  id: ID; mediaId: ID; sourceStart: number; sourceEnd: number; timelineStart: number;
  speed: number; crop: NormalizedCrop; transform: NormalizedTransform; audio: ClipAudio;
}
export interface Track { id: ID; name: string; kind: 'video' | 'overlay' | 'audio'; clips: Clip[]; muted: boolean; locked: boolean }
export interface Background {
  type: 'solid' | 'gradient' | 'blur';
  color: string;
  color2: string;
  mediaId?: ID;
  blur: number;
}
export interface ExportSettings {
  width: number; height: number; aspect: '16:9' | '9:16' | '1:1' | '4:5' | '4:3';
  fps: 24 | 25 | 30 | 50 | 60; quality: 'draft' | 'standard' | 'high';
}
export interface ProjectV1 {
  version: 1; id: ID; name: string; media: Record<ID, Media>; tracks: Track[];
  background: Background; export: ExportSettings; updatedAt: string;
}

export const DEFAULT_CROP: NormalizedCrop = { x: 0, y: 0, width: 1, height: 1 };
export const DEFAULT_TRANSFORM: NormalizedTransform = {
  x: 0, y: 0, width: 1, height: 1, scale: 1, rotation: 0, flipX: false, flipY: false,
};
export const createProject = (): ProjectV1 => ({
  version: 1, id: crypto.randomUUID(), name: '제목 없는 프로젝트', media: {},
  tracks: [
    { id: 'video-main', name: '메인 비디오', kind: 'video', clips: [], muted: false, locked: false },
    { id: 'overlay-1', name: '오버레이 1', kind: 'overlay', clips: [], muted: false, locked: false },
    { id: 'audio-1', name: '오디오 1', kind: 'audio', clips: [], muted: false, locked: false },
  ],
  background: { type: 'solid', color: '#050609', color2: '#182133', blur: 20 },
  export: { width: 1920, height: 1080, aspect: '16:9', fps: 30, quality: 'high' },
  updatedAt: new Date().toISOString(),
});

export const clipMedia = (mediaMap: Record<ID, Media>, clip: Clip) => mediaMap[clip.mediaId];
