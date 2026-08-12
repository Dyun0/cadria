import { create } from 'zustand';
import { assertProject, changeSpeed, deleteClip, moveClip, projectDuration, rippleGap, splitClip, trimClip } from '../core/edit';
import { createProject, DEFAULT_CROP, DEFAULT_TRANSFORM, safeUUID, type Clip, type Media, type ProjectV1 } from '../core/types';

const STORAGE_KEY = 'cadria.project';
const MAX_HISTORY = 80;
const migrateProject = (value: ProjectV1): ProjectV1 => {
  const fallback = createProject();
  return {
    ...fallback,
    ...value,
    background: { ...fallback.background, ...value.background },
    export: { ...fallback.export, ...value.export },
  };
};
const loadProject = (): ProjectV1 => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (raw?.version === 1) {
      const migrated = migrateProject(raw);
      assertProject(migrated);
      return migrated;
    }
    if (raw?.tracks) return migrateProject({ ...createProject(), ...raw, version: 1 });
  } catch { /* start clean after invalid or old data */ }
  return createProject();
};

interface EditorState {
  project: ProjectV1; past: ProjectV1[]; future: ProjectV1[]; selectedClipId?: string;
  selectedTrackId: string; playhead: number; playing: boolean; zoom: number; timelineHeight: number;
  cropMode: boolean; copiedClip: Clip | null; notice?: { kind: 'error' | 'success'; message: string };
  theme: 'dark' | 'light'; showSettingsModal: boolean;
  setTheme: (theme: 'dark' | 'light') => void; setShowSettingsModal: (show: boolean) => void;
  commit: (project: ProjectV1) => void; undo: () => void; redo: () => void;
  newProject: () => void;
  addMedia: (media: Media) => void; deleteMedia: (mediaId: string) => void; addClip: (mediaId: string, trackId?: string) => void;
  addOverlayClip: (mediaId: string) => void; addAudioClip: (mediaId: string) => void;
  addTrack: (kind: 'video' | 'overlay' | 'audio') => void; deleteTrack: (trackId: string) => void;
  updateClip: (id: string, patch: Partial<Clip>) => void; trim: (id: string, edge: 'start' | 'end', time: number) => void;
  split: () => void; move: (id: string, time: number, trackId?: string) => void; remove: () => void;
  ripple: () => void; speed: (id: string, value: number) => void;
  copyClip: (id?: string) => void; cutClip: (id?: string) => void; pasteClip: () => void; duplicateClip: (id?: string) => void; resetTransform: (id?: string) => void;
  reorderLayer: (clipId: string, direction: 'front' | 'forward' | 'backward' | 'back') => void;
}

const savedTheme = (localStorage.getItem('cadria.theme') as 'dark' | 'light') || 'dark';

export const useEditorStore = create<EditorState>((set, get) => ({
  project: loadProject(), past: [], future: [], selectedTrackId: 'video-1',
  playhead: 0, playing: false, zoom: 80, timelineHeight: 248, cropMode: false, copiedClip: null,
  theme: savedTheme, showSettingsModal: false,
  setTheme: (theme) => {
    localStorage.setItem('cadria.theme', theme);
    set({ theme });
  },
  setShowSettingsModal: (showSettingsModal) => set({ showSettingsModal }),
  commit: (project) => {
    if (project === get().project) return;
    project = { ...project, updatedAt: new Date().toISOString() };
    // 오디오 트랙만 항상 하단에 위치하도록 보정 (비디오/오버레이 트랙 간의 상대 순서는 보존)
    const visual = project.tracks.filter(t => t.kind !== 'audio');
    const audio = project.tracks.filter(t => t.kind === 'audio');
    project = { ...project, tracks: [...visual, ...audio] };
    assertProject(project);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    set((state) => ({
      project,
      past: [...state.past.slice(-(MAX_HISTORY - 1)), state.project],
      future: [],
      playhead: Math.min(state.playhead, projectDuration(project)),
    }));
  },
  newProject: () => {
    const fresh = createProject();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    set({
      project: fresh,
      past: [],
      future: [],
      selectedClipId: undefined,
      playhead: 0,
      playing: false,
      notice: { kind: 'success', message: '새 프로젝트가 생성되었습니다' },
    });
  },
  undo: () => {
    const { past, project, future } = get();
    if (!past.length) return;
    const previous = past[past.length - 1];
    const mergedPrevious = {
      ...previous,
      media: { ...project.media, ...previous.media },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedPrevious));
    set({
      project: mergedPrevious,
      past: past.slice(0, -1),
      future: [project, ...future],
      selectedClipId: undefined,
      notice: { kind: 'success', message: '실행 취소 (Undo)' },
    });
  },
  redo: () => set((state) => {
    const project = state.future[0]; if (!project) return state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    return { project, past: [...state.past, state.project], future: state.future.slice(1) };
  }),
  addMedia: (media) => {
    const next = structuredClone(get().project);
    next.media[media.id] = media;
    get().commit(next);
  },
  deleteMedia: (mediaId) => {
    const next = structuredClone(get().project);
    delete next.media[mediaId];
    for (const track of next.tracks) {
      track.clips = track.clips.filter((c) => c.mediaId !== mediaId);
    }
    get().commit(next);
    set({ notice: { kind: 'success', message: '미디어가 라이브러리에서 삭제되었습니다' } });
  },
  addTrack: (kind) => {
    const next = structuredClone(get().project);
    const count = next.tracks.filter((t) => t.kind === kind).length + 1;
    const name = kind === 'video' ? `비디오 ${count}` : kind === 'overlay' ? `오버레이 ${count}` : `오디오 ${count}`;
    const id = `${kind}-${safeUUID().slice(0, 6)}`;
    const newTrack = { id, name, kind, clips: [], muted: false, locked: false };

    if (kind === 'overlay') {
      const overlayIndices = next.tracks.map((t, idx) => t.kind === 'overlay' ? idx : -1).filter((idx) => idx >= 0);
      const lastOverlayIndex = overlayIndices.length > 0 ? Math.max(...overlayIndices) : -1;
      if (lastOverlayIndex >= 0) {
        next.tracks.splice(lastOverlayIndex + 1, 0, newTrack);
      } else {
        next.tracks.unshift(newTrack);
      }
    } else {
      next.tracks.push(newTrack);
    }

    get().commit(next);
    set({ selectedTrackId: id, notice: { kind: 'success', message: `${name} 트랙이 생성되었습니다` } });
  },
  deleteTrack: (trackId) => {
    const next = structuredClone(get().project);
    if (next.tracks.length <= 1) {
      set({ notice: { kind: 'error', message: '최소 하나의 트랙은 유지되어야 합니다' } });
      return;
    }
    const trackName = next.tracks.find((t) => t.id === trackId)?.name ?? '트랙';
    next.tracks = next.tracks.filter((t) => t.id !== trackId);
    get().commit(next);
    set((state) => ({
      selectedTrackId: next.tracks[0].id,
      selectedClipId: state.selectedClipId && next.tracks.some((t) => t.clips.some((c) => c.id === state.selectedClipId)) ? state.selectedClipId : undefined,
      notice: { kind: 'success', message: `[${trackName}] 트랙이 삭제되었습니다` },
    }));
  },
  duplicateClip: (id) => {
    const targetId = id ?? get().selectedClipId;
    if (!targetId) return;
    const { project } = get();
    let foundClip: Clip | undefined;
    let foundTrackId: string | undefined;
    for (const track of project.tracks) {
      const c = track.clips.find((clip) => clip.id === targetId);
      if (c) { foundClip = c; foundTrackId = track.id; break; }
    }
    if (!foundClip || !foundTrackId) return;

    const dur = (foundClip.sourceEnd - foundClip.sourceStart) / foundClip.speed;
    const newClip: Clip = {
      ...structuredClone(foundClip),
      id: safeUUID(),
      timelineStart: foundClip.timelineStart + dur + 0.1,
    };
    const next = structuredClone(project);
    next.tracks.find((t) => t.id === foundTrackId)!.clips.push(newClip);
    get().commit(next);
    set({ selectedClipId: newClip.id, notice: { kind: 'success', message: '클립이 복제되었습니다' } });
  },
  addClip: (mediaId, trackId) => {
    const { project, selectedTrackId } = get(); const media = project.media[mediaId]; if (!media) return;
    const next = structuredClone(project);
    let targetTrack = next.tracks.find((item) => item.id === (trackId ?? selectedTrackId)) ?? next.tracks.find((t) => t.kind === 'video') ?? next.tracks[0];
    if (!targetTrack) {
      targetTrack = { id: 'video-main', name: '메인 비디오', kind: 'video', clips: [], muted: false, locked: false };
      next.tracks.push(targetTrack);
    }
    const clipEndTimes = targetTrack.clips.map((clip) => clip.timelineStart + (clip.sourceEnd - clip.sourceStart) / clip.speed);
    const start = clipEndTimes.length === 0 ? 0 : Math.max(0, ...clipEndTimes);
    const clip: Clip = {
      id: safeUUID(), mediaId, sourceStart: 0, sourceEnd: media.duration, timelineStart: start, speed: 1,
      crop: { ...DEFAULT_CROP }, transform: targetTrack.kind === 'overlay' ? { ...DEFAULT_TRANSFORM, x: .2, y: .2, width: .6, height: .6 } : { ...DEFAULT_TRANSFORM },
      audio: { enabled: targetTrack.kind !== 'overlay' && media.hasAudio, volume: 1 },
    };
    targetTrack.clips.push(clip);

    // 오디오가 있고 이미지가 아닐 때만 오디오 트랙에 자동 연결
    if (media.hasAudio && !media.isImage && targetTrack.kind !== 'audio') {
      let audioTrack = next.tracks.find((t) => t.kind === 'audio');
      if (!audioTrack) {
        audioTrack = { id: 'audio-1', name: '오디오 1', kind: 'audio', clips: [], muted: false, locked: false };
        next.tracks.push(audioTrack);
      }
      const audioClip: Clip = {
        id: safeUUID(), mediaId, sourceStart: 0, sourceEnd: media.duration, timelineStart: start, speed: 1,
        crop: { ...DEFAULT_CROP }, transform: { ...DEFAULT_TRANSFORM },
        audio: { enabled: true, volume: 1 },
      };
      audioTrack.clips.push(audioClip);
    }

    // Auto fit zoom for video addition so clip end is always visible on timeline
    const videoEnd = start + (media.duration / clip.speed);
    const autoZoom = targetTrack.kind === 'video' ? Math.max(2, Math.min(240, Math.floor(700 / Math.max(4, videoEnd)))) : get().zoom;

    assertProject(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    set((state) => ({
      project: next,
      past: [...state.past.slice(-(MAX_HISTORY - 1)), state.project],
      future: [],
      selectedClipId: clip.id,
      selectedTrackId: targetTrack.id,
      playhead: start,
      zoom: autoZoom,
      notice: { kind: 'success', message: `${media.name} 클립이 타임라인에 추가되었습니다` },
    }));
  },
  addOverlayClip: (mediaId) => {
    const { project, playhead } = get(); const media = project.media[mediaId]; if (!media) return;
    const next = structuredClone(project);
    const overlayTracks = next.tracks.filter((t) => t.kind === 'overlay');
    
    // Find an overlay track where playhead is free or create a new overlay track
    let targetTrack = overlayTracks.find((t) => {
      return !t.clips.some((c) => {
        const dur = (c.sourceEnd - c.sourceStart) / c.speed;
        return playhead >= c.timelineStart && playhead < c.timelineStart + dur;
      });
    });

    if (!targetTrack) {
      const count = overlayTracks.length + 1;
      targetTrack = { id: `overlay-${Date.now()}`, name: `오버레이 ${count}`, kind: 'overlay', clips: [], muted: false, locked: false };
      let lastOverlayIdx = -1;
      for (let i = next.tracks.length - 1; i >= 0; i--) {
        if (next.tracks[i].kind === 'overlay' || next.tracks[i].kind === 'video') {
          lastOverlayIdx = i;
          break;
        }
      }
      next.tracks.splice(Math.max(0, lastOverlayIdx + 1), 0, targetTrack);
    }

    const clipEndTimes = targetTrack.clips.map((clip) => clip.timelineStart + (clip.sourceEnd - clip.sourceStart) / clip.speed);
    const start = clipEndTimes.length === 0 ? playhead : Math.max(playhead, ...clipEndTimes);
    const clip: Clip = {
      id: safeUUID(), mediaId, sourceStart: 0, sourceEnd: media.duration, timelineStart: start, speed: 1,
      crop: { ...DEFAULT_CROP }, transform: { ...DEFAULT_TRANSFORM, x: .2, y: .2, width: .6, height: .6 },
      audio: { enabled: media.hasAudio, volume: 1 },
    };
    targetTrack.clips.push(clip);
    assertProject(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    set((state) => ({
      project: next,
      past: [...state.past.slice(-(MAX_HISTORY - 1)), state.project],
      future: [],
      selectedClipId: clip.id,
      selectedTrackId: targetTrack.id,
      notice: { kind: 'success', message: `${media.name} 클립이 [${targetTrack.name}] 트랙에 추가되었습니다` },
    }));
  },
  addAudioClip: (mediaId) => {
    const { project } = get(); const media = project.media[mediaId]; if (!media) return;
    const next = structuredClone(project);
    let track = next.tracks.find((t) => t.kind === 'audio');
    if (!track) {
      track = { id: 'audio-1', name: '오디오 1', kind: 'audio', clips: [], muted: false, locked: false };
      next.tracks.push(track);
    }
    const clipEndTimes = track.clips.map((clip) => clip.timelineStart + (clip.sourceEnd - clip.sourceStart) / clip.speed);
    const start = clipEndTimes.length === 0 ? 0 : Math.max(0, ...clipEndTimes);
    const clip: Clip = {
      id: safeUUID(), mediaId, sourceStart: 0, sourceEnd: media.duration, timelineStart: start, speed: 1,
      crop: { ...DEFAULT_CROP }, transform: { ...DEFAULT_TRANSFORM },
      audio: { enabled: true, volume: 1 },
    };
    track.clips.push(clip);
    assertProject(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    set((state) => ({
      project: next,
      past: [...state.past.slice(-(MAX_HISTORY - 1)), state.project],
      future: [],
      selectedClipId: clip.id,
      playhead: start,
      notice: { kind: 'success', message: `${media.name} 오디오 트랙에 추가되었습니다` },
    }));
  },
  updateClip: (id, patch) => {
    const next = structuredClone(get().project);
    for (const track of next.tracks) { const index = track.clips.findIndex((clip) => clip.id === id); if (index >= 0) track.clips[index] = { ...track.clips[index], ...patch }; }
    get().commit(next);
  },
  trim: (id, edge, time) => get().commit(trimClip(get().project, id, edge, time)),
  split: () => {
    const { project, selectedClipId, playhead } = get();
    const id = selectedClipId ?? project.tracks.flatMap((t) => t.clips).find((c) => playhead > c.timelineStart && playhead < c.timelineStart + (c.sourceEnd-c.sourceStart)/c.speed)?.id;
    if (id) get().commit(splitClip(project, id, playhead));
  },
  move: (id, time, trackId) => get().commit(moveClip(get().project, id, time, trackId)),
  remove: () => { const id = get().selectedClipId; if (id) { get().commit(deleteClip(get().project, id)); set({ selectedClipId: undefined }); } },
  ripple: () => get().commit(rippleGap(get().project, get().selectedTrackId)),
  speed: (id, value) => get().commit(changeSpeed(get().project, id, value)),
  copyClip: (id) => {
    const targetId = id ?? get().selectedClipId;
    if (!targetId) return;
    const clip = findSelectedClip(get()) ?? get().project.tracks.flatMap((t) => t.clips).find((c) => c.id === targetId);
    if (clip) {
      set({ copiedClip: structuredClone(clip) });
      set({ notice: { kind: 'success', message: '클립이 복사되었습니다' } });
    }
  },
  cutClip: (id) => {
    const targetId = id ?? get().selectedClipId;
    if (!targetId) return;
    const clip = findSelectedClip(get()) ?? get().project.tracks.flatMap((t) => t.clips).find((c) => c.id === targetId);
    if (clip) {
      set({ copiedClip: structuredClone(clip) });
      get().commit(deleteClip(get().project, targetId));
      set({ selectedClipId: undefined, notice: { kind: 'success', message: '클립을 잘라냈습니다' } });
    }
  },
  pasteClip: () => {
    const { copiedClip, project, playhead } = get();
    if (!copiedClip) return;
    const next = structuredClone(project);
    const overlayTracks = next.tracks.filter((t) => t.kind === 'overlay');

    // Find an overlay track where playhead is free or create a new overlay track
    let targetTrack = overlayTracks.find((t) => {
      return !t.clips.some((c) => {
        const dur = (c.sourceEnd - c.sourceStart) / c.speed;
        return playhead >= c.timelineStart && playhead < c.timelineStart + dur;
      });
    });

    if (!targetTrack) {
      const count = overlayTracks.length + 1;
      targetTrack = { id: `overlay-${Date.now()}`, name: `오버레이 ${count}`, kind: 'overlay', clips: [], muted: false, locked: false };
      let lastOverlayIdx = -1;
      for (let i = next.tracks.length - 1; i >= 0; i--) {
        if (next.tracks[i].kind === 'overlay' || next.tracks[i].kind === 'video') {
          lastOverlayIdx = i;
          break;
        }
      }
      next.tracks.splice(Math.max(0, lastOverlayIdx + 1), 0, targetTrack);
    }

    const newClip: Clip = {
      ...structuredClone(copiedClip),
      id: safeUUID(),
      timelineStart: playhead,
      transform: { ...copiedClip.transform, x: Math.min(0.6, copiedClip.transform.x + 0.05), y: Math.min(0.6, copiedClip.transform.y + 0.05) },
    };
    targetTrack.clips.push(newClip);
    get().commit(next);
    set({ selectedClipId: newClip.id, selectedTrackId: targetTrack.id, notice: { kind: 'success', message: `[${targetTrack.name}] 트랙에 붙여넣었습니다` } });
  },
  resetTransform: (id) => {
    const targetId = id ?? get().selectedClipId;
    if (!targetId) return;
    const next = structuredClone(get().project);
    for (const track of next.tracks) {
      const index = track.clips.findIndex((clip) => clip.id === targetId);
      if (index >= 0) {
        track.clips[index].transform = { ...DEFAULT_TRANSFORM };
        track.clips[index].crop = { ...DEFAULT_CROP };
      }
    }
    get().commit(next);
    set({ notice: { kind: 'success', message: '변형 및 자르기(Crop)가 초기화되었습니다' } });
  },
  reorderLayer: (clipId, direction) => {
    const { project } = get();
    const next = structuredClone(project);
    let srcTrackIdx = -1;
    let targetClip: Clip | undefined;

    for (let i = 0; i < next.tracks.length; i++) {
      const c = next.tracks[i].clips.find((clip) => clip.id === clipId);
      if (c) {
        srcTrackIdx = i;
        targetClip = c;
        break;
      }
    }

    if (srcTrackIdx < 0 || !targetClip) return;

    const visualTrackIndices = next.tracks
      .map((t, idx) => (t.kind !== 'audio' ? idx : -1))
      .filter((idx) => idx >= 0);

    const currentVisualPos = visualTrackIndices.indexOf(srcTrackIdx);
    if (currentVisualPos < 0) return;

    let targetTrackIdx = srcTrackIdx;

    if (direction === 'front') {
      const topVisualIdx = visualTrackIndices[visualTrackIndices.length - 1];
      if (srcTrackIdx === topVisualIdx) {
        const count = next.tracks.filter((t) => t.kind === 'overlay').length + 1;
        const newTrack = {
          id: `overlay-${Date.now()}`,
          name: `오버레이 ${count}`,
          kind: 'overlay' as const,
          clips: [],
          muted: false,
          locked: false,
        };
        const audioStartIdx = next.tracks.findIndex((t) => t.kind === 'audio');
        const insertIdx = audioStartIdx >= 0 ? audioStartIdx : next.tracks.length;
        next.tracks.splice(insertIdx, 0, newTrack);
        targetTrackIdx = insertIdx;
      } else {
        targetTrackIdx = topVisualIdx;
      }
    } else if (direction === 'back') {
      targetTrackIdx = visualTrackIndices[0];
    } else if (direction === 'forward') {
      if (currentVisualPos < visualTrackIndices.length - 1) {
        targetTrackIdx = visualTrackIndices[currentVisualPos + 1];
      } else {
        const count = next.tracks.filter((t) => t.kind === 'overlay').length + 1;
        const newTrack = {
          id: `overlay-${Date.now()}`,
          name: `오버레이 ${count}`,
          kind: 'overlay' as const,
          clips: [],
          muted: false,
          locked: false,
        };
        const audioStartIdx = next.tracks.findIndex((t) => t.kind === 'audio');
        const insertIdx = audioStartIdx >= 0 ? audioStartIdx : next.tracks.length;
        next.tracks.splice(insertIdx, 0, newTrack);
        targetTrackIdx = insertIdx;
      }
    } else if (direction === 'backward') {
      if (currentVisualPos > 0) {
        targetTrackIdx = visualTrackIndices[currentVisualPos - 1];
      }
    }

    if (targetTrackIdx !== srcTrackIdx) {
      next.tracks[srcTrackIdx].clips = next.tracks[srcTrackIdx].clips.filter((c) => c.id !== clipId);
      next.tracks[targetTrackIdx].clips.push(targetClip);
      get().commit(next);
      set({
        selectedTrackId: next.tracks[targetTrackIdx].id,
        notice: { kind: 'success', message: '클립 레이어 위치가 변경되었습니다' },
      });
    }
  },
}));

export const findSelectedClip = (state: EditorState) =>
  state.project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === state.selectedClipId);
