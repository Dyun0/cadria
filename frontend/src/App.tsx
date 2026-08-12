import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowDownToLine, Check, ChevronLeft, ChevronRight, Copy, Crop, Download, FilePlus, Film, FolderUp, Gauge, LoaderCircle, Lock, Maximize2,
  Pause, Play, Plus, Redo2, RotateCw, Scissors, SkipBack, Trash2, Undo2, Unlink, Volume2, VolumeX, X,
} from 'lucide-react';
import { api, type ExportJob } from './api/transport';
import { clipDuration, moveClip, projectDuration, trimClip } from './core/edit';
import { clipMedia, type Clip, type ExportSettings, type NormalizedCrop, type ProjectV1 } from './core/types';
import { findSelectedClip, useEditorStore } from './store/editorStore';
import './tokens.css';
import './styles.css';

const ASPECTS: Record<ExportSettings['aspect'], [number, number]> = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '4:3': [1440, 1080],
};

const tc = (seconds: number, fps: number) => {
  const pad = (n: number, z = 2) => String(Math.floor(n)).padStart(z, '0');
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * fps);
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
};
const terminal = (status: ExportJob['status']) => status === 'complete' || status === 'error' || status === 'cancelled';

function Topbar({ openExport, confirmNewProject }: { openExport: () => void; confirmNewProject: () => void }) {
  const s = useEditorStore();
  return <header className="topbar">
    <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div className="brand-logo" onClick={() => s.setShowSettingsModal(true)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }} title="설정 창 열기">
        <Film style={{ color: '#06b6d4' }} /> Cadria Studio <span style={{ fontSize: '10px', background: 'rgba(6,182,212,0.15)', color: '#06b6d4', padding: '2px 6px', borderRadius: '4px', marginLeft: '2px' }}>설정</span>
      </div>
      <div className="divider" style={{ height: '18px', borderLeft: '1px solid var(--line)', margin: '0 6px' }} />
      <button className="tool-button" title="새 프로젝트 시작" onClick={confirmNewProject}><FilePlus /> 새 프로젝트</button>
      <button className="icon-button" title="실행 취소 (Ctrl+Z)" disabled={!s.past.length} onClick={s.undo}><Undo2 /></button>
      <button className="icon-button" title="다시 실행 (Ctrl+Y)" disabled={!s.future.length} onClick={s.redo}><Redo2 /></button>
    </div>
    <div className="topbar-actions">
      <button className="export-button" onClick={openExport}><ArrowDownToLine /> 내보내기</button>
    </div>
  </header>;
}

function MediaLibrary({ openContextMenu, confirmDelete, onSelectMedia, onAddMediaToTrack }: { openContextMenu: (e: React.MouseEvent, mediaId: string) => void; confirmDelete: (mediaId: string) => void; onSelectMedia: (mediaId: string) => void; onAddMediaToTrack: (mediaId: string) => void }) {
  const s = useEditorStore(); const ref = useRef<HTMLInputElement>(null); const [drag, setDrag] = useState(false);
  const [uploadingTasks, setUploadingTasks] = useState<{ id: string; name: string }[]>([]);

  const addFiles = async (files: FileList | File[]) => {
    const valid = Array.from(files).filter(f => f.type.startsWith('video/') || f.type.startsWith('audio/') || f.type.startsWith('image/'));
    await Promise.all(valid.map(async (f) => {
      const taskId = `up-${Math.random().toString(36).substring(2, 9)}`;
      setUploadingTasks(prev => [...prev, { id: taskId, name: f.name }]);
      try {
        const m = await api.upload(f);
        s.addMedia(m);
      } catch (e) {
        useEditorStore.setState({ notice: { kind: 'error', message: e instanceof Error ? e.message : `${f.name} 업로드 실패` } });
      } finally {
        setUploadingTasks(prev => prev.filter(t => t.id !== taskId));
      }
    }));
  };
  return <aside className="media-panel" aria-label="미디어 라이브러리">
    <div className="panel-heading"><div><span>LIBRARY</span><h2>내 미디어</h2></div></div>
    <input ref={ref} hidden type="file" multiple accept="video/*,audio/*,image/*" onChange={(e) => e.target.files && void addFiles(e.target.files)} />
    <div className={`upload-zone ${drag ? 'is-dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files); }} onClick={() => ref.current?.click()}>
      <FolderUp /><strong>미디어/오디오 드래그 또는 클릭</strong><small>비디오 (MP4, AVI), 오디오, 이미지 지원</small>
    </div>
    {uploadingTasks.length > 0 && (
      <div className="upload-loading-list">
        {uploadingTasks.map((item) => (
          <div key={item.id} className="upload-loading-badge">
            <LoaderCircle className="spin" style={{ width: 14, height: 14 }} />
            <span>미디어 분석 및 업로드 중... ({item.name})</span>
          </div>
        ))}
      </div>
    )}
    <div className="media-list">{Object.values(s.project.media).map((m) => <div className="media-item" key={m.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', m.id)} onClick={() => onSelectMedia(m.id)} onContextMenu={(e) => openContextMenu(e, m.id)}>
      <div className="media-thumb">{m.thumbnailUrl ? <img src={m.thumbnailUrl} alt={m.name} /> : <Film />}</div>
      <div className="media-copy"><strong>{m.originalName || m.name}</strong><small>{tc(m.duration, s.project.export.fps)}</small></div>
      <div className="media-actions" style={{ marginLeft: 'auto', display: 'flex', gap: '3px' }}>
        <button className="icon-button add-media-btn" title="타임라인 트랙에 추가" onClick={(e) => { e.stopPropagation(); onAddMediaToTrack(m.id); }}><Plus /></button>
        <button className="icon-button delete-media-btn" title="미디어 삭제" onClick={(e) => { e.stopPropagation(); confirmDelete(m.id); }}><Trash2 /></button>
      </div>
    </div>)}</div>
  </aside>;
}

const RECOMMENDED_RESOLUTIONS: Record<ExportSettings['aspect'], { label: string; width: number; height: number }[]> = {
  '16:9': [
    { label: 'FHD 1080p (1920×1080)', width: 1920, height: 1080 },
    { label: '4K UHD (3840×2160)', width: 3840, height: 2160 },
    { label: 'HD 720p (1280×720)', width: 1280, height: 720 },
  ],
  '9:16': [
    { label: '숏폼 1080p (1080×1920)', width: 1080, height: 1920 },
    { label: '숏폼 720p (720×1280)', width: 720, height: 1280 },
    { label: '숏폼 4K (2160×3840)', width: 2160, height: 3840 },
  ],
  '1:1': [
    { label: '정사각형 (1080×1080)', width: 1080, height: 1080 },
    { label: '정사각형 4K (2160×2160)', width: 2160, height: 2160 },
    { label: '정사각형 720p (720×720)', width: 720, height: 720 },
  ],
  '4:5': [
    { label: '인스타그램 4:5 (1080×1350)', width: 1080, height: 1350 },
    { label: '고해상도 4:5 (1440×1800)', width: 1440, height: 1800 },
  ],
  '4:3': [
    { label: '클래식 4:3 (1440×1080)', width: 1440, height: 1080 },
    { label: '고해상도 4:3 (2880×2160)', width: 2880, height: 2160 },
  ],
};

function Stage({ openCanvasContextMenu }: { openCanvasContextMenu: (e: React.MouseEvent, clipId: string) => void }) {
  const s = useEditorStore(); const frame = useRef<HTMLDivElement>(null); const current = findSelectedClip(s);
  const [guideLine, setGuideLine] = useState<{ x?: number; y?: number }>({});
  const [isCustomRes, setIsCustomRes] = useState(false);
  const selectedAspect = s.project.export.aspect;
  const recommendedList = RECOMMENDED_RESOLUTIONS[selectedAspect] ?? [];

  useEffect(() => {
    if (!s.playing) return;
    let lastTime = performance.now();
    let animId: number;
    const loop = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;
      const state = useEditorStore.getState();
      const dur = projectDuration(state.project);
      const nextTime = state.playhead + delta;
      if (nextTime >= dur && dur > 0) {
        useEditorStore.setState({ playhead: 0, playing: false });
      } else {
        useEditorStore.setState({ playhead: nextTime });
        animId = requestAnimationFrame(loop);
      }
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [s.playing]);

  const handleSelectResolution = (val: string) => {
    if (val === 'custom') {
      setIsCustomRes(true);
      return;
    }
    setIsCustomRes(false);
    const [w, h] = val.split('x').map(Number);
    if (!w || !h) return;
    const project = structuredClone(s.project);
    project.export.width = w;
    project.export.height = h;
    s.commit(project);
  };

  const handleCustomDimension = (key: 'width' | 'height', val: number) => {
    if (isNaN(val) || val <= 0) return;
    const project = structuredClone(s.project);
    project.export[key] = val;
    s.commit(project);
  };

  return <main className="stage-shell" aria-label="미리보기 스테이지">
    <div className="stage-meta">
      <div className="stage-meta-controls">
        <span>화면비:</span>
        <select value={selectedAspect} onChange={(e) => {
          const aspect = e.target.value as ExportSettings['aspect'];
          const rec = RECOMMENDED_RESOLUTIONS[aspect][0];
          const project = structuredClone(s.project);
          project.export = { ...project.export, aspect, width: rec.width, height: rec.height };
          s.commit(project);
          setIsCustomRes(false);
        }}>
          {Object.keys(ASPECTS).map((aspect) => <option key={aspect} value={aspect}>{aspect}</option>)}
        </select>

        <span style={{ marginLeft: '12px' }}>해상도:</span>
        <select value={isCustomRes ? 'custom' : `${s.project.export.width}x${s.project.export.height}`} onChange={(e) => handleSelectResolution(e.target.value)}>
          {recommendedList.map((r) => <option key={`${r.width}x${r.height}`} value={`${r.width}x${r.height}`}>{r.label}</option>)}
          <option value="custom">사용자 지정 (Custom...)</option>
        </select>

        {isCustomRes && <>
          <input className="resolution-input" style={{ marginLeft: '6px' }} type="number" value={s.project.export.width} onChange={(e) => handleCustomDimension('width', Number(e.target.value))} />
          <span>×</span>
          <input className="resolution-input" type="number" value={s.project.export.height} onChange={(e) => handleCustomDimension('height', Number(e.target.value))} />
        </>}
      </div>
    </div>

    <div className="stage-viewport">
      <div ref={frame} className="stage-frame" style={{
        aspectRatio: `${s.project.export.width}/${s.project.export.height}`,
        height: '100%',
        maxWidth: '100%',
        background: getBackgroundCss(s.project.background),
      }}>
        {guideLine.x !== undefined && <div className="snap-guide-line vertical" style={{ left: `${guideLine.x * 100}%` }} />}
        {guideLine.y !== undefined && <div className="snap-guide-line horizontal" style={{ top: `${guideLine.y * 100}%` }} />}

        {s.project.tracks.map((track, trackIdx) => {
          if (track.kind === 'audio') return null;
          return track.clips.map((clip) => {
            const media = clipMedia(s.project.media, clip); if (!media) return null;
            const active = s.playhead >= clip.timelineStart && s.playhead <= clip.timelineStart + clipDuration(clip);
            if (!active) return null;
            return <ClipRender key={clip.id} clip={clip} media={media} playhead={s.playhead} playing={s.playing} selected={s.selectedClipId === clip.id} zIndex={(trackIdx + 1) * 10} stageRef={frame} setGuideLine={setGuideLine} onClick={() => useEditorStore.setState({ selectedClipId: clip.id })} openCanvasContextMenu={openCanvasContextMenu} />;
          });
        })}
        {s.cropMode && current && <CropOverlay clip={current} stageRef={frame} />}
        {!s.project.tracks.some((t) => t.clips.length > 0) && <div className="stage-empty"><Film /><span>미디어를 타임라인으로 끌어다 놓으세요</span></div>}
      </div>
    </div>

    <StageControlBar />
  </main>;
}

function StageControlBar() {
  const s = useEditorStore(); const dur = projectDuration(s.project); const fps = s.project.export.fps;
  const frameTime = 1 / fps;

  const stepFrame = (delta: number) => {
    const nextTime = Math.max(0, Math.min(dur, s.playhead + delta * frameTime));
    useEditorStore.setState({ playhead: nextTime, playing: false });
  };

  const toggleFullscreen = () => {
    const el = document.querySelector('.stage-frame');
    if (document.fullscreenElement) document.exitFullscreen();
    else void el?.requestFullscreen();
  };

  return (
    <div className="stage-control-bar">
      <button className="icon-button" title="1프레임 이전" onClick={() => stepFrame(-1)}><ChevronLeft /></button>
      <button className="play-btn-main" title={s.playing ? '일시정지 (Space)' : '재생 (Space)'} onClick={() => useEditorStore.setState({ playing: !s.playing })}>
        {s.playing ? <Pause /> : <Play />}
      </button>
      <button className="icon-button" title="1프레임 이후" onClick={() => stepFrame(1)}><ChevronRight /></button>
      <div className="timecode-badge">{tc(s.playhead, fps)} <span>/ {tc(dur, fps)}</span></div>
      <button className="icon-button" title="전체화면 미리보기" onClick={toggleFullscreen}><Maximize2 /></button>
    </div>
  );
}

function getBackgroundCss(bg: ProjectV1['background']) {
  if (bg.type === 'gradient') return `linear-gradient(135deg, ${bg.color}, ${bg.color2 ?? '#000'})`;
  if (bg.type === 'solid') return bg.color;
  return bg.color;
}

function ClipRender({ clip, media, playhead, playing, selected, zIndex, stageRef, setGuideLine, onClick, openCanvasContextMenu }: { clip: Clip; media: any; playhead: number; playing: boolean; selected: boolean; zIndex?: number; stageRef: React.RefObject<HTMLDivElement | null>; setGuideLine: (g: { x?: number; y?: number }) => void; onClick: () => void; openCanvasContextMenu: (e: React.MouseEvent, clipId: string) => void }) {
  const video = useRef<HTMLVideoElement>(null); const t = clip.transform; const c = clip.crop;
  const [isMediaLoading, setIsMediaLoading] = useState(!media.isImage);

  useEffect(() => {
    if (media.isImage) setIsMediaLoading(false);
  }, [media.isImage]);
  useEffect(() => {
    const el = video.current; if (!el || media.isImage) return;
    const mediaTime = Math.max(0, clip.sourceStart + (playhead - clip.timelineStart) * clip.speed);
    
    if (el.playbackRate !== clip.speed) {
      el.playbackRate = clip.speed;
    }

    if (playing) {
      if (Math.abs(el.currentTime - mediaTime) > 0.15) {
        el.currentTime = mediaTime;
      }
      if (el.paused) {
        void el.play().catch(() => {});
      }
    } else {
      if (!el.paused) {
        el.pause();
      }
      if (Math.abs(el.currentTime - mediaTime) > 0.02) {
        el.currentTime = mediaTime;
      }
    }
  }, [playhead, clip, playing, media.isImage]);

  const handlePointerDown = (e: ReactPointerEvent) => {
    onClick();
    const box = stageRef.current?.getBoundingClientRect(); if (!box) return;
    const startX = e.clientX, startY = e.clientY;
    const initialTransform = { ...clip.transform };
    const s = useEditorStore.getState();
    const baseline = structuredClone(s.project); let latest = baseline; let changed = false;

    // Collect other active video/overlay clip edge targets for inter-clip magnetic snapping
    const otherClipTargets: { x: number[]; y: number[] } = { x: [0, 0.5, 1], y: [0, 0.5, 1] };
    for (const tr of s.project.tracks) {
      if (tr.kind === 'audio') continue;
      for (const cl of tr.clips) {
        if (cl.id === clip.id) continue;
        const active = s.playhead >= cl.timelineStart && s.playhead <= cl.timelineStart + clipDuration(cl);
        if (!active) continue;
        const cW = cl.transform.width * cl.transform.scale;
        const cH = cl.transform.height * cl.transform.scale;
        otherClipTargets.x.push(cl.transform.x, cl.transform.x + cW / 2, cl.transform.x + cW);
        otherClipTargets.y.push(cl.transform.y, cl.transform.y + cH / 2, cl.transform.y + cH);
      }
    }

    const move = (p: PointerEvent) => {
      const dx = (p.clientX - startX) / box.width;
      const dy = (p.clientY - startY) / box.height;
      let rawX = initialTransform.x + dx;
      let rawY = initialTransform.y + dy;

      const curW = initialTransform.width * initialTransform.scale;
      const curH = initialTransform.height * initialTransform.scale;
      const SNAP_PX = 0.03;
      let snapX: number | undefined, snapY: number | undefined;

      // Magnetic snapping for X (left, center, right edges) against all other video clips
      for (const targetX of otherClipTargets.x) {
        if (Math.abs(rawX - targetX) <= SNAP_PX) { rawX = targetX; snapX = targetX; break; }
        if (Math.abs(rawX + curW - targetX) <= SNAP_PX) { rawX = targetX - curW; snapX = targetX; break; }
        if (Math.abs(rawX + curW / 2 - targetX) <= SNAP_PX) { rawX = targetX - curW / 2; snapX = targetX; break; }
      }

      // Magnetic snapping for Y (top, middle, bottom edges) against all other video clips
      for (const targetY of otherClipTargets.y) {
        if (Math.abs(rawY - targetY) <= SNAP_PX) { rawY = targetY; snapY = targetY; break; }
        if (Math.abs(rawY + curH - targetY) <= SNAP_PX) { rawY = targetY - curH; snapY = targetY; break; }
        if (Math.abs(rawY + curH / 2 - targetY) <= SNAP_PX) { rawY = targetY - curH / 2; snapY = targetY; break; }
      }

      setGuideLine({ x: snapX, y: snapY });
      latest = structuredClone(baseline); changed = true;
      const target = latest.tracks.flatMap((track) => track.clips).find((item) => item.id === clip.id);
      if (target) target.transform = { ...target.transform, x: rawX, y: rawY };
      useEditorStore.setState({ project: latest });
    };

    const up = () => {
      setGuideLine({});
      if (changed) { useEditorStore.setState({ project: baseline }); useEditorStore.getState().commit(latest); }
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const beginTransform = (e: ReactPointerEvent, handle: string) => {
    e.stopPropagation();
    const box = stageRef.current?.getBoundingClientRect(); if (!box) return;
    const start = { x: e.clientX, y: e.clientY, transform: { ...clip.transform } };
    const initialRatio = start.transform.width / start.transform.height;
    const baseline = structuredClone(useEditorStore.getState().project); let latest = baseline; let changed = false;

    // Opposite Anchor Point calculation for 100% fixed corner
    const anchorX = handle.includes('w') ? start.transform.x + start.transform.width : start.transform.x;
    const anchorY = handle.includes('n') ? start.transform.y + start.transform.height : start.transform.y;

    const move = (p: PointerEvent) => {
      const dx = (p.clientX - start.x) / box.width;
      const dy = (p.clientY - start.y) / box.height;
      const next = { ...start.transform };

      const isCorner = ['nw', 'ne', 'sw', 'se'].includes(handle);

      if (isCorner) {
        let newW = start.transform.width;
        if (handle.includes('e')) newW = Math.max(0.05, start.transform.width + dx);
        if (handle.includes('w')) newW = Math.max(0.05, start.transform.width - dx);

        let curX = handle.includes('w') ? anchorX - newW : anchorX;
        const SNAP = 0.04;
        let snapX: number | undefined, snapY: number | undefined;

        // Snap left/right/center while preserving aspect ratio
        if (Math.abs(curX) <= SNAP) { curX = 0; if (handle.includes('w')) newW = anchorX; snapX = 0; }
        else if (Math.abs(curX + newW - 1) <= SNAP) { newW = 1 - curX; snapX = 1; }
        else if (Math.abs(curX + newW / 2 - 0.5) <= SNAP) { snapX = 0.5; }

        let newH = Math.max(0.05, newW / initialRatio);
        let curY = handle.includes('n') ? anchorY - newH : anchorY;

        // Snap top/bottom/center
        if (Math.abs(curY) <= SNAP) { curY = 0; if (handle.includes('n')) newH = anchorY; newW = newH * initialRatio; snapY = 0; }
        else if (Math.abs(curY + newH - 1) <= SNAP) { snapY = 1; }
        else if (Math.abs(curY + newH / 2 - 0.5) <= SNAP) { snapY = 0.5; }

        // Recalculate curX & curY to strictly preserve aspect ratio
        curX = handle.includes('w') ? anchorX - newW : anchorX;
        curY = handle.includes('n') ? anchorY - newH : anchorY;

        setGuideLine({ x: snapX, y: snapY });

        next.width = newW;
        next.height = newH;
        next.x = curX;
        next.y = curY;
      } else {
        // Edge center handles (n, s, w, e) snapping
        const SNAP = 0.04;
        let snapX: number | undefined, snapY: number | undefined;

        if (handle.includes('e')) {
          let newW = Math.max(0.05, start.transform.width + dx);
          if (Math.abs(start.transform.x + newW - 1) <= SNAP) { newW = 1 - start.transform.x; snapX = 1; }
          else if (Math.abs(start.transform.x + newW / 2 - 0.5) <= SNAP) { snapX = 0.5; }
          next.width = newW;
        }
        if (handle.includes('w')) {
          let newW = Math.max(0.05, start.transform.width - dx);
          let newX = start.transform.x + (start.transform.width - newW);
          if (Math.abs(newX) <= SNAP) { newX = 0; newW = start.transform.x + start.transform.width; snapX = 0; }
          else if (Math.abs(newX + newW / 2 - 0.5) <= SNAP) { snapX = 0.5; }
          next.x = newX; next.width = newW;
        }
        if (handle.includes('s')) {
          let newH = Math.max(0.05, start.transform.height + dy);
          if (Math.abs(start.transform.y + newH - 1) <= SNAP) { newH = 1 - start.transform.y; snapY = 1; }
          else if (Math.abs(start.transform.y + newH / 2 - 0.5) <= SNAP) { snapY = 0.5; }
          next.height = newH;
        }
        if (handle.includes('n')) {
          let newH = Math.max(0.05, start.transform.height - dy);
          let newY = start.transform.y + (start.transform.height - newH);
          if (Math.abs(newY) <= SNAP) { newY = 0; newH = start.transform.y + start.transform.height; snapY = 0; }
          else if (Math.abs(newY + newH / 2 - 0.5) <= SNAP) { snapY = 0.5; }
          next.y = newY; next.height = newH;
        }

        setGuideLine({ x: snapX, y: snapY });
      }

      latest = structuredClone(baseline); changed = true;
      const target = latest.tracks.flatMap((track) => track.clips).find((item) => item.id === clip.id);
      if (target) target.transform = next;
      useEditorStore.setState({ project: latest });
    };
    const up = () => {
      setGuideLine({});
      if (changed) { useEditorStore.setState({ project: baseline }); useEditorStore.getState().commit(latest); }
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const cropW = Math.max(0.001, c?.width || 1);
  const cropH = Math.max(0.001, c?.height || 1);
  const cropX = c?.x || 0;
  const cropY = c?.y || 0;

  const style: CSSProperties = {
    left: `${t.x * 100}%`, top: `${t.y * 100}%`,
    width: `${t.width * t.scale * 100}%`, height: `${t.height * t.scale * 100}%`,
    transform: `rotate(${t.rotation}deg) scale(${t.flipX ? -1 : 1}, ${t.flipY ? -1 : 1})`,
    zIndex: zIndex ?? 10,
    ['--video-w' as any]: `${(1 / cropW) * 100}%`,
    ['--video-h' as any]: `${(1 / cropH) * 100}%`,
    ['--video-x' as any]: `${-(cropX / cropW) * 100}%`,
    ['--video-y' as any]: `${-(cropY / cropH) * 100}%`,
  };
  return <div className={`stage-clip ${selected ? 'selected' : ''}`} style={style} onPointerDown={handlePointerDown} onContextMenu={(e) => { e.stopPropagation(); openCanvasContextMenu(e, clip.id); }}>
    <div className="clip-video-box">
      {isMediaLoading && (
        <div className="video-loading-overlay">
          <LoaderCircle className="spin" style={{ width: 22, height: 22, color: 'var(--accent-cyan)' }} />
          <span>미디어 준비 중...</span>
        </div>
      )}
      {media.isImage
        ? <img src={media.url} style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }} draggable={false} />
        : <video
            ref={video}
            src={media.url}
            playsInline
            preload="auto"
            muted={!clip.audio.enabled}
            onWaiting={() => setIsMediaLoading(true)}
            onLoadStart={() => setIsMediaLoading(true)}
            onCanPlay={() => setIsMediaLoading(false)}
            onLoadedData={() => setIsMediaLoading(false)}
            style={{ display: 'block' }}
          />}
    </div>
    {selected && <div className="transform-handles">
      {['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'].map((h) => <button key={h} aria-label={`${h} 크기 조절 핸들`} className={`transform-handle ${h}`} onPointerDown={(e) => beginTransform(e, h)} />)}
    </div>}
  </div>;
}

function CropOverlay({ clip, stageRef }: { clip: Clip; stageRef: React.RefObject<HTMLDivElement | null> }) {
  const source = useRef<HTMLDivElement>(null);
  const begin = (e: ReactPointerEvent, handle: string) => {
    e.stopPropagation(); const box = source.current?.getBoundingClientRect(); if (!box) return;
    const start = { x: e.clientX, y: e.clientY, crop: { ...clip.crop } };
    const s = useEditorStore.getState();
    const baseline = structuredClone(s.project); let latest = baseline; let changed = false;
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - start.x) / box.width, dy = (e.clientY - start.y) / box.height; const c: NormalizedCrop = { ...start.crop }; const min = .04;
      if (handle.includes('w')) { const x = Math.min(c.x + c.width - min, Math.max(0, c.x + dx)); c.width -= x - c.x; c.x = x; }
      if (handle.includes('e')) c.width = Math.max(min, Math.min(1 - c.x, c.width + dx));
      if (handle.includes('n')) { const y = Math.min(c.y + c.height - min, Math.max(0, c.y + dy)); c.height -= y - c.y; c.y = y; }
      if (handle.includes('s')) c.height = Math.max(min, Math.min(1 - c.x, c.height + dy));
      latest = structuredClone(baseline); changed = true;
      const target = latest.tracks.flatMap((track) => track.clips).find((item) => item.id === clip.id);
      if (target) target.crop = c;
      useEditorStore.setState({ project: latest });
    };
    const up = () => { if (changed) { useEditorStore.setState({ project: baseline }); useEditorStore.getState().commit(latest); } window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const transform = clip.transform;
  return <div className="crop-layer" onPointerDown={(e) => e.stopPropagation()}><div ref={source} className="crop-source" style={{
    left: `${transform.x * 100}%`, top: `${transform.y * 100}%`,
    width: `${transform.width * transform.scale * 100}%`, height: `${transform.height * transform.scale * 100}%`,
    transform: `rotate(${transform.rotation}deg)`,
  }}><div className="crop-box" style={{ left: `${clip.crop.x * 100}%`, top: `${clip.crop.y * 100}%`, width: `${clip.crop.width * 100}%`, height: `${clip.crop.height * 100}%` }}>
      {['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'].map((h) => <button key={h} aria-label={`${h} 크롭 핸들`} className={`crop-handle ${h}`} onPointerDown={(e) => begin(e, h)} />)}
    </div></div></div>;
}

function Inspector() {
  const s = useEditorStore(); const clip = findSelectedClip(s);
  const expW = s.project.export.width; const expH = s.project.export.height;
  const patchTransform = (key: string, value: number | boolean) => clip && s.updateClip(clip.id, { transform: { ...clip.transform, [key]: value } });
  const patchPx = (key: 'x' | 'y' | 'width' | 'height', pxVal: number) => {
    if (!clip) return;
    const normVal = key === 'x' || key === 'width' ? pxVal / expW : pxVal / expH;
    s.updateClip(clip.id, { transform: { ...clip.transform, [key]: normVal } });
  };
  const updateProject = (update: (project: typeof s.project) => void) => {
    const project = structuredClone(s.project); update(project); s.commit(project);
  };

  const centerClip = () => {
    if (!clip) return;
    const curW = clip.transform.width * clip.transform.scale;
    const curH = clip.transform.height * clip.transform.scale;
    s.updateClip(clip.id, { transform: { ...clip.transform, x: (1 - curW) / 2, y: (1 - curH) / 2 } });
  };

  const isAudioTrack = s.project.tracks.find(t => t.clips.some(c => c.id === clip?.id))?.kind === 'audio';

  return <aside className="inspector" aria-label="인스펙터">
    <div className="panel-heading">
      <div>
        <span>{isAudioTrack ? 'AUDIO TOOLKIT' : 'STUDIO TOOLKIT'}</span>
        <h2>{!clip ? '프로젝트 설정' : isAudioTrack ? '오디오 편집 도구' : '비디오 편집 도구'}</h2>
      </div>
    </div>
    {!clip ? <><Section title="캔버스">
      <Field label="화면비"><select value={s.project.export.aspect} onChange={(e) => {
        const aspect = e.target.value as ExportSettings['aspect']; const [width, height] = ASPECTS[aspect];
        updateProject((project) => { project.export = { ...project.export, aspect, width, height }; });
      }}>{Object.keys(ASPECTS).map((aspect) => <option key={aspect}>{aspect}</option>)}</select></Field>
      <Field label="배경"><select value={s.project.background.type} onChange={(e) => updateProject((project) => { project.background.type = e.target.value as typeof project.background.type; })}>
        <option value="solid">단색</option><option value="gradient">그라디언트</option><option value="blur">흐림</option>
      </select></Field>
      <Field label="배경 색"><input type="color" value={s.project.background.color} onChange={(e) => updateProject((project) => { project.background.color = e.target.value; })} /></Field>
      {s.project.background.type === 'gradient' && <Field label="두 번째 색"><input type="color" value={s.project.background.color2} onChange={(e) => updateProject((project) => { project.background.color2 = e.target.value; })} /></Field>}
      {s.project.background.type === 'blur' && <><Field label="흐림 소스"><select value={s.project.background.mediaId ?? ''} onChange={(e) => updateProject((project) => { project.background.mediaId = e.target.value || undefined; })}><option value="">선택</option>{Object.values(s.project.media).map((media) => <option key={media.id} value={media.id}>{media.name}</option>)}</select></Field>
        <Field label={`흐림 ${s.project.background.blur}px`}><input type="range" min="4" max="48" value={s.project.background.blur} onChange={(e) => updateProject((project) => { project.background.blur = Number(e.target.value); })} /></Field></>}
    </Section><p className="empty" style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: '11px', whiteSpace: 'nowrap', margin: 0 }}>클립을 선택하면 편집할 수 있습니다.</p></> :
      isAudioTrack ? <>
        <Section title="음량 조절">
          <label className="switch-row" style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '11.5px', fontWeight: '500' }}>
              {clip.audio.enabled ? <Volume2 style={{ width: 16, height: 16, flexShrink: 0 }} /> : <VolumeX style={{ width: 16, height: 16, flexShrink: 0 }} />} 오디오 출력 활성화
            </span>
            <input type="checkbox" checked={clip.audio.enabled} onChange={e => s.updateClip(clip.id, { audio: { ...clip.audio, enabled: e.target.checked } })} />
          </label>
          <Field label={`볼륨 크기 (${Math.round(clip.audio.volume * 100)}%)`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input disabled={!clip.audio.enabled} type="range" min="0" max="2" step=".01" value={clip.audio.volume} onChange={e => s.updateClip(clip.id, { audio: { ...clip.audio, volume: Number(e.target.value) } })} style={{ flex: 1 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <input disabled={!clip.audio.enabled} type="number" min="0" max="200" style={{ width: '54px', textAlign: 'center', padding: '3px 4px', fontSize: '11.5px', borderRadius: '4px' }} value={Math.round(clip.audio.volume * 100)} onChange={e => s.updateClip(clip.id, { audio: { ...clip.audio, volume: Math.max(0, Math.min(200, Number(e.target.value))) / 100 } })} />
                <span style={{ fontSize: '11.5px', fontWeight: '600', color: 'var(--muted)' }}>%</span>
              </div>
            </div>
          </Field>
        </Section>
        <Section title="오디오 속도">
          <Field label={`재생 속도 (${clip.speed}×)`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="range" min="0.25" max="4.0" step="0.05" value={clip.speed} onChange={e => s.speed(clip.id, Number(e.target.value))} style={{ flex: 1 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <input type="number" min="0.25" max="4.0" step="0.1" style={{ width: '54px', textAlign: 'center', padding: '3px 4px', fontSize: '11.5px', borderRadius: '4px' }} value={clip.speed} onChange={e => s.speed(clip.id, Math.max(0.1, Number(e.target.value)))} />
                <span style={{ fontSize: '11.5px', fontWeight: '600', color: 'var(--muted)' }}>×</span>
              </div>
            </div>
          </Field>
        </Section>
      </> :
        <><Section title="변형">
          <div className="field-grid">
            <Field label="X (PX)"><input type="number" value={Math.round(clip.transform.x * expW)} onChange={e => patchPx('x', Number(e.target.value))} /></Field>
            <Field label="Y (PX)"><input type="number" value={Math.round(clip.transform.y * expH)} onChange={e => patchPx('y', Number(e.target.value))} /></Field>
            <Field label="WIDTH (PX)"><input type="number" value={Math.round(clip.transform.width * expW)} onChange={e => patchPx('width', Number(e.target.value))} /></Field>
            <Field label="HEIGHT (PX)"><input type="number" value={Math.round(clip.transform.height * expH)} onChange={e => patchPx('height', Number(e.target.value))} /></Field>
          </div>
          <Field label={`크기 ${Math.round(clip.transform.scale * 100)}%`}><input type="range" min=".1" max="2" step=".01" value={clip.transform.scale} onChange={e => patchTransform('scale', Number(e.target.value))} /></Field>
          <div className="btn-group-2" style={{ marginBottom: '6px' }}>
            <button className={`tool-button ${s.cropMode ? 'active' : ''}`} onClick={() => useEditorStore.setState({ cropMode: !s.cropMode })}><Crop />크롭</button>
            <button className="tool-button" onClick={() => patchTransform('rotation', ((clip.transform.rotation + 90) % 360))}><RotateCw />회전</button>
          </div>
          <div className="btn-group-2" style={{ marginBottom: '6px' }}>
            <button className={`tool-button ${clip.transform.flipX ? 'active' : ''}`} onClick={() => patchTransform('flipX', !clip.transform.flipX)}>좌우 반전</button>
            <button className={`tool-button ${clip.transform.flipY ? 'active' : ''}`} onClick={() => patchTransform('flipY', !clip.transform.flipY)}>상하 반전</button>
          </div>
          <div style={{ marginTop: '6px' }}>
            <button className="tool-button wide" onClick={() => s.resetTransform(clip.id)} title="확대/자르기/변형 초기화">
              <RotateCw /> 원래대로 (Reset)
            </button>
          </div>
        </Section><Section title="속도">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="range" min="0.25" max="4.0" step="0.05" value={clip.speed} onChange={e => s.speed(clip.id, Number(e.target.value))} style={{ flex: 1 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <input type="number" min="0.25" max="4.0" step="0.1" style={{ width: '56px', textAlign: 'center' }} value={clip.speed} onChange={e => s.speed(clip.id, Math.max(0.1, Number(e.target.value)))} />
                <span style={{ fontSize: '12px', fontWeight: 'bold' }}>×</span>
              </div>
            </div>
          </Section></>}
  </aside>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="inspector-section"><h3>{title}</h3>{children}</section> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label> }

function Timeline({ openContextMenu, openTrackContextMenu }: { openContextMenu: (e: React.MouseEvent, clipId?: string) => void; openTrackContextMenu: (e: React.MouseEvent, trackId: string) => void }) {
  const s = useEditorStore(); const scroll = useRef<HTMLDivElement>(null); const duration = Math.max(10, projectDuration(s.project) + 2); const width = duration * s.zoom;
  const [snapIndicator, setSnapIndicator] = useState<number | null>(null);

  const getSnapPoints = (excludeClipId: string) => {
    const points: number[] = [0, s.playhead];
    for (const track of s.project.tracks) {
      for (const c of track.clips) {
        if (c.id === excludeClipId) continue;
        const dur = clipDuration(c);
        points.push(c.timelineStart, c.timelineStart + dur);
      }
    }
    return points;
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaY) > 0) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.25 : 0.75;
      const nextZoom = Math.max(1, Math.min(240, Math.round(s.zoom * factor)));
      useEditorStore.setState({ zoom: nextZoom });
    }
  };

  const scrub = (e: ReactPointerEvent) => {
    const setTime = (clientX: number) => {
      const rect = scroll.current!.getBoundingClientRect();
      useEditorStore.setState({ playhead: Math.max(0, (clientX - rect.left + scroll.current!.scrollLeft) / s.zoom), playing: false });
    };
    setTime(e.clientX);
    const move = (event: PointerEvent) => setTime(event.clientX);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const drag = (e: ReactPointerEvent, clip: Clip, trackId: string) => {
    e.stopPropagation();
    const x = e.clientX, start = clip.timelineStart, baseline = structuredClone(s.project);
    let latest = baseline, changed = false;
    const dur = clipDuration(clip);
    const snapPoints = getSnapPoints(clip.id);
    const SNAP_PX = 12;

    const rect = scroll.current!.getBoundingClientRect();
    const clickTime = Math.max(0, (e.clientX - rect.left + scroll.current!.scrollLeft) / s.zoom);

    const move = (p: PointerEvent) => {
      if (Math.abs(p.clientX - x) > 3) {
        let rawStart = start + (p.clientX - x) / s.zoom;
        let rawEnd = rawStart + dur;
        let finalStart = rawStart;
        let activeSnapTime: number | null = null;

        for (const pt of snapPoints) {
          if (Math.abs(rawStart - pt) * s.zoom <= SNAP_PX) {
            finalStart = pt; activeSnapTime = pt; break;
          }
          if (Math.abs(rawEnd - pt) * s.zoom <= SNAP_PX) {
            finalStart = pt - dur; activeSnapTime = pt; break;
          }
        }

        setSnapIndicator(activeSnapTime);
        latest = moveClip(baseline, clip.id, Math.max(0, finalStart), trackId);
        changed = latest !== baseline;
        useEditorStore.setState({ project: latest, selectedClipId: clip.id, selectedTrackId: trackId });
      }
    };

    const up = (p: PointerEvent) => {
      setSnapIndicator(null);
      if (Math.abs(p.clientX - x) <= 3) {
        useEditorStore.setState({ playhead: clickTime, selectedClipId: clip.id, selectedTrackId: trackId, playing: false });
      } else if (changed) {
        useEditorStore.setState({ project: baseline });
        useEditorStore.getState().commit(latest);
      }
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const trim = (e: ReactPointerEvent, clip: Clip, edge: 'start' | 'end') => {
    e.stopPropagation();
    const x = e.clientX, origin = edge === 'start' ? clip.sourceStart : clip.sourceEnd, baseline = structuredClone(s.project);
    let latest = baseline, changed = false;
    const move = (p: PointerEvent) => {
      latest = trimClip(baseline, clip.id, edge, origin + (p.clientX - x) / s.zoom * clip.speed);
      changed = latest !== baseline;
      useEditorStore.setState({ project: latest });
    };
    const up = () => {
      if (changed) {
        useEditorStore.setState({ project: baseline });
        useEditorStore.getState().commit(latest);
      }
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const stepSec = s.zoom < 10 ? 60 : s.zoom < 25 ? 10 : s.zoom < 60 ? 5 : 1;
  const tickCount = Math.ceil(duration / stepSec);
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => i * stepSec);
  return <section className="timeline-shell" style={{ height: s.timelineHeight }} onContextMenu={(e) => openContextMenu(e)}>
    <button className="timeline-resizer" aria-label="타임라인 높이 조절" onPointerDown={(e) => { const y = e.clientY, h = s.timelineHeight; const move = (p: PointerEvent) => useEditorStore.setState({ timelineHeight: Math.max(180, Math.min(460, h + y - p.clientY)) }); const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); }} />
    <div className="timeline-toolbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <strong>타임라인</strong>
        <div className="divider" style={{ height: '14px', borderLeft: '1px solid var(--line)', margin: '0 4px' }} />
        <button className="tool-button" onClick={s.split} title="선택된 클립 분할 (S)"><Scissors /> 분할</button>
        <button className="tool-button danger" onClick={s.remove} title="클립 삭제 (Delete)"><Trash2 /> 삭제</button>
        <button className="tool-button" onClick={() => s.copyClip()} title="클립 복사 (Ctrl+C)"><Copy /> 복사</button>
        <button className="tool-button" onClick={() => s.pasteClip()} title="붙여넣기 (Ctrl+V)"><Copy /> 붙여넣기</button>
        <button className="tool-button" onClick={s.ripple} title="빈 공간 당기기 (G)">리플 지우기</button>
        <div className="divider" style={{ height: '14px', borderLeft: '1px solid var(--line)', margin: '0 4px' }} />
        <button className="tool-button" onClick={() => s.addTrack('overlay')} title="신규 오버레이 트랙 추가"><Plus /> 오버레이 트랙</button>
        <button className="tool-button" onClick={() => s.addTrack('audio')} title="신규 오디오 트랙 추가"><Plus /> 오디오 트랙</button>
      </div>
      <span className="spacer" />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Gauge />
        <input aria-label="타임라인 확대" type="range" min="2" max="240" value={s.zoom} onChange={e => useEditorStore.setState({ zoom: Number(e.target.value) })} />
      </div>
    </div>
    <div className="timeline-grid"><div className="ruler-gutter">{tc(s.playhead, s.project.export.fps)}</div><div ref={scroll} className="timeline-scroll" onPointerDown={(e) => { if (e.button !== 0) return; scrub(e); }} onWheel={handleWheel} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const mediaId = e.dataTransfer.getData('text/plain'); if (mediaId) s.addClip(mediaId); }}>
      <div className="timeline-content" style={{ width }}>
        <div className="ruler">{ticks.map(t => <span key={t} style={{ left: t * s.zoom }}>{s.zoom < 10 ? `${Math.floor(t / 60)}분` : tc(t, s.project.export.fps).slice(3, 8)}</span>)}</div>
        {snapIndicator !== null && <div className="timeline-snap-indicator" style={{ left: snapIndicator * s.zoom }} />}
        {s.project.tracks.map(track => <div className="track-lane" key={track.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const mediaId = e.dataTransfer.getData('text/plain'); if (mediaId) s.addClip(mediaId, track.id); }}>{track.clips.map(clip => {
          const m = clipMedia(s.project.media, clip);
          const filename = m?.originalName || m?.name || '파일';
          const clipLabel = `${track.kind === 'audio' ? '오디오' : '비디오'} - ${filename}`;
          return <div key={clip.id} className={`timeline-clip ${track.kind} ${s.selectedClipId === clip.id ? 'selected' : ''}`} style={{ left: clip.timelineStart * s.zoom, width: Math.max(8, clipDuration(clip) * s.zoom) }} onPointerDown={e => drag(e, clip, track.id)} onDoubleClick={(e) => { e.stopPropagation(); useEditorStore.setState({ playhead: clip.timelineStart, selectedClipId: clip.id, playing: false }); }} onContextMenu={(e) => { e.stopPropagation(); openContextMenu(e, clip.id); }}>
            <button className="trim-handle left" aria-label="시작 트림" onPointerDown={e => trim(e, clip, 'start')} /><span>{clipLabel}</span><button className="trim-handle right" aria-label="끝 트림" onPointerDown={e => trim(e, clip, 'end')} />
          </div>;
        })}</div>)}
        <div className="playhead" style={{ left: s.playhead * s.zoom }} />
      </div></div>
      <div className="track-gutter">{s.project.tracks.map(track => <button key={track.id} className={s.selectedTrackId === track.id ? 'selected' : ''} onClick={() => useEditorStore.setState({ selectedTrackId: track.id })} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openTrackContextMenu(e, track.id); }}>{track.kind === 'audio' ? <Volume2 /> : <Film />}<span>{track.name}</span>{track.locked && <Lock />}</button>)}</div>
    </div>
  </section>;
}

function SelectTrackModal({ mediaId, close }: { mediaId: string; close: () => void }) {
  const s = useEditorStore();
  const media = s.project.media[mediaId];
  return <div className="modal-backdrop" role="presentation" onPointerDown={e => e.target === e.currentTarget && close()}>
    <div className="modal" style={{ width: '420px' }}>
      <div className="modal-header">
        <div><span>TARGET TRACK</span><h2>트랙 선택</h2></div>
        <button className="icon-button" onClick={close}><X /></button>
      </div>
      <p style={{ color: 'var(--text)', fontSize: '13px', margin: '0 0 16px', lineHeight: '1.5' }}>
        <strong>[{media?.name ?? '미디어'}]</strong>를 어떤 트랙에 추가하시겠습니까?
      </p>
      <div style={{ display: 'grid', gap: '8px', marginBottom: '16px' }}>
        <button className="secondary" style={{ justifyContent: 'flex-start', padding: '10px 14px' }} onClick={() => { s.addClip(mediaId); close(); }}>
          🎬 메인 비디오 트랙에 추가
        </button>
        <button className="secondary" style={{ justifyContent: 'flex-start', padding: '10px 14px' }} onClick={() => { s.addOverlayClip(mediaId); close(); }}>
          🖼️ 신규 오버레이 트랙(PIP)에 추가
        </button>
        <button className="secondary" style={{ justifyContent: 'flex-start', padding: '10px 14px' }} onClick={() => { s.addAudioClip(mediaId); close(); }}>
          🎵 오디오 트랙에 추가
        </button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="secondary" onClick={close}>취소</button>
      </div>
    </div>
  </div>;
}

function ContextMenu({ x, y, clipId, close }: { x: number; y: number; clipId?: string; close: () => void }) {
  const s = useEditorStore();
  useEffect(() => {
    const handleDown = () => close();
    window.addEventListener('pointerdown', handleDown);
    return () => window.removeEventListener('pointerdown', handleDown);
  }, [close]);

  const safeX = Math.max(10, Math.min(x, window.innerWidth - 200));
  const safeY = Math.max(10, Math.min(y, window.innerHeight - 220));

  return <div className="context-menu" style={{ left: safeX, top: safeY }} onPointerDown={(e) => e.stopPropagation()}>
    {clipId && <>
      <button className="context-menu-item" onClick={() => { s.duplicateClip(clipId); close(); }}><Copy /> 복제 (Ctrl+D)</button>
      <button className="context-menu-item" onClick={() => { s.copyClip(clipId); close(); }}><Copy /> 복사 (Ctrl+C)</button>
      <button className="context-menu-item" onClick={() => { s.cutClip(clipId); close(); }}><Scissors /> 잘라내기 (Ctrl+X)</button>
    </>}
    {s.copiedClip && <button className="context-menu-item" onClick={() => { s.pasteClip(); close(); }}><Download /> 붙여넣기 (Ctrl+V)</button>}
    {clipId && <>
      <div className="context-menu-divider" />
      <button className="context-menu-item" onClick={() => { s.split(); close(); }}><Scissors /> 분할 (S)</button>
      <button className="context-menu-item" onClick={() => { s.resetTransform(clipId); close(); }}><RotateCw /> 원래대로 (Reset)</button>
      <button className="context-menu-item danger" onClick={() => { s.remove(); close(); }}><Trash2 /> 삭제 (Delete)</button>
    </>}
  </div>;
}

function CanvasContextMenu({ x, y, clipId, close }: { x: number; y: number; clipId: string; close: () => void }) {
  const s = useEditorStore();
  const clip = s.project.tracks.flatMap(t => t.clips).find(c => c.id === clipId);

  useEffect(() => {
    const handleDown = () => close();
    window.addEventListener('pointerdown', handleDown);
    return () => window.removeEventListener('pointerdown', handleDown);
  }, [close]);

  if (!clip) return null;
  const safeX = Math.max(10, Math.min(x, window.innerWidth - 220));
  const safeY = Math.max(10, Math.min(y, window.innerHeight - 340));

  return <div className="context-menu" style={{ left: safeX, top: safeY, width: '210px' }} onPointerDown={(e) => e.stopPropagation()}>
    <button className="context-menu-item" onClick={() => { s.duplicateClip(clipId); close(); }}>
      <Copy style={{ width: 14 }} /> <span>복제</span> <small style={{ marginLeft: 'auto', opacity: 0.6 }}>CTRL+D</small>
    </button>
    <button className="context-menu-item" onClick={() => { s.copyClip(clipId); close(); }}>
      <Copy style={{ width: 14 }} /> <span>복사</span> <small style={{ marginLeft: 'auto', opacity: 0.6 }}>CTRL+C</small>
    </button>
    <button className="context-menu-item" onClick={() => { s.cutClip(clipId); close(); }}>
      <Scissors style={{ width: 14 }} /> <span>잘라내기</span> <small style={{ marginLeft: 'auto', opacity: 0.6 }}>CTRL+X</small>
    </button>
    <button className="context-menu-item" onClick={() => { s.reorderLayer(clipId, 'front'); close(); }}>
      <ArrowDownToLine style={{ width: 14, transform: 'rotate(180deg)' }} /> <span>맨 앞으로 가져오기</span>
    </button>
    <button className="context-menu-item" onClick={() => { s.reorderLayer(clipId, 'forward'); close(); }}>
      <ChevronLeft style={{ width: 14, transform: 'rotate(90deg)' }} /> <span>한 단계 앞으로</span>
    </button>
    <button className="context-menu-item" onClick={() => { s.reorderLayer(clipId, 'backward'); close(); }}>
      <ChevronRight style={{ width: 14, transform: 'rotate(90deg)' }} /> <span>한 단계 뒤로</span>
    </button>
    <button className="context-menu-item" onClick={() => { s.reorderLayer(clipId, 'back'); close(); }}>
      <ArrowDownToLine style={{ width: 14 }} /> <span>맨 뒤로 보내기</span>
    </button>
    <div className="context-menu-divider" />
    <button className="context-menu-item" onClick={() => { s.copyClip(clipId); close(); }}>
      <Copy style={{ width: 14 }} /> <span>클립 복사</span> <small style={{ marginLeft: 'auto', opacity: 0.6 }}>CTRL+C</small>
    </button>
    {s.copiedClip && <button className="context-menu-item" onClick={() => { s.pasteClip(); close(); }}>
      <Download style={{ width: 14 }} /> <span>오버레이로 붙여넣기</span> <small style={{ marginLeft: 'auto', opacity: 0.6 }}>CTRL+V</small>
    </button>}
    <button className="context-menu-item danger" onClick={() => { s.remove(); close(); }}>
      <Trash2 style={{ width: 14 }} /> <span>삭제</span> <small style={{ marginLeft: 'auto', opacity: 0.6 }}>DEL</small>
    </button>
    <div className="context-menu-divider" />
    <button className="context-menu-item" onClick={() => { useEditorStore.setState({ cropMode: !s.cropMode }); close(); }}>
      <Crop style={{ width: 14 }} /> <span>{s.cropMode ? '크롭 완료' : '자르기 (Crop)'}</span>
    </button>
    <button className="context-menu-item" onClick={() => { s.updateClip(clipId, { transform: { ...clip.transform, rotation: ((clip.transform.rotation + 90) % 360) as 0 | 90 | 180 | 270 } }); close(); }}>
      <RotateCw style={{ width: 14 }} /> <span>90° 회전</span>
    </button>
    <button className="context-menu-item" onClick={() => { s.resetTransform(clipId); close(); }}>
      <RotateCw style={{ width: 14 }} /> <span>변형 원래대로 (Reset)</span>
    </button>
  </div>;
}

function TrackContextMenu({ x, y, trackId, close }: { x: number; y: number; trackId: string; close: () => void }) {
  const s = useEditorStore();
  const track = s.project.tracks.find(t => t.id === trackId);
  useEffect(() => {
    const handleDown = () => close();
    window.addEventListener('pointerdown', handleDown);
    return () => window.removeEventListener('pointerdown', handleDown);
  }, [close]);

  if (!track) return null;
  const safeX = Math.max(10, Math.min(x, window.innerWidth - 180));
  const safeY = Math.max(10, Math.min(y, window.innerHeight - 150));

  return <div className="context-menu" style={{ left: safeX, top: safeY }} onPointerDown={(e) => e.stopPropagation()}>
    <div style={{ padding: '6px 12px', fontSize: '11px', fontWeight: 'bold', color: 'var(--muted)' }}>{track.name}</div>
    <div className="context-menu-divider" />
    <button className="context-menu-item danger" onClick={() => { s.deleteTrack(trackId); close(); }}>
      <Trash2 style={{ width: 14 }} /> <span>트랙 삭제 (Delete Track)</span>
    </button>
  </div>;
}

function ExportModal({ close }: { close: () => void }) {
  const s = useEditorStore(); const [exportName, setExportName] = useState(s.project.name || '내_비디오_프로젝트');
  const [quality, setQuality] = useState<ExportSettings['quality']>(s.project.export.quality || 'high');
  const [format, setFormat] = useState<'mp4' | 'avi'>(s.project.export.format || 'mp4');
  const [job, setJob] = useState<ExportJob>(); const [busy, setBusy] = useState(false); const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; const element = dialog.current; const focusable = () => Array.from(element?.querySelectorAll<HTMLElement>('button,a[href],select,input:not([disabled])') ?? []).filter(item => !item.hasAttribute('disabled'));
    focusable()[0]?.focus(); const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close() } }; document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); previous?.focus() }
  }, [close]);
  useEffect(() => { const current = job; if (!current || terminal(current.status)) return; return api.watchExport(current.id, setJob) }, [job?.id]);

  const start = async () => {
    setJob(undefined);
    setBusy(true);
    try {
      const p = structuredClone(s.project);
      p.name = exportName;
      p.export.quality = quality;
      p.export.format = format;
      s.commit(p);
      setJob(await api.createExport(p));
    } catch (e) {
      setJob({ id: '', status: 'error', progress: 0, error: e instanceof Error ? e.message : '내보내기 실패' });
    } finally { setBusy(false); }
  };

  const cancelCurrentJob = async () => {
    if (!job) return;
    try {
      await api.cancelExport(job.id);
    } catch {
      // Ignore cancellation API error
    } finally {
      setJob(prev => prev ? { ...prev, status: 'cancelled' } : undefined);
      close();
    }
  };

  return <div className="modal-backdrop" role="presentation" onPointerDown={e => e.target === e.currentTarget && (!job || terminal(job.status)) && close()}>
    <div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title" style={{ width: '350px' }}>
      <div className="modal-header">
        <h2 id="export-title" style={{ margin: 0, fontSize: '15px' }}>비디오 내보내기</h2>
      </div>
      {!job ? <div className="export-form" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '2px' }}>
        <Field label="출력 파일 이름">
          <input type="text" value={exportName} onChange={e => setExportName(e.target.value)} placeholder="내_비디오_프로젝트" style={{ width: '100%', padding: '7px 10px', background: 'var(--input-bg)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text)', fontSize: '12.5px' }} />
        </Field>
        <Field label="출력 비디오 포맷">
          <select value={format} onChange={e => setFormat(e.target.value as 'mp4' | 'avi')} style={{ width: '100%', padding: '7px 10px', background: 'var(--input-bg)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text)', fontSize: '12.5px' }}>
            <option value="mp4">MP4 비디오 (.mp4)</option>
            <option value="avi">AVI 비디오 (.avi)</option>
          </select>
        </Field>
        <Field label="비디오 화질 품질">
          <select value={quality} onChange={e => setQuality(e.target.value as ExportSettings['quality'])} style={{ width: '100%', padding: '7px 10px', background: 'var(--input-bg)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text)', fontSize: '12.5px' }}>
            <option value="draft">표준 화질 (Standard)</option>
            <option value="standard">고화질 (High Quality HD)</option>
            <option value="high">최고 화질 (Pro Ultra HD)</option>
          </select>
        </Field>
        <button className="primary wide" style={{ height: '36px', fontSize: '13px', fontWeight: 'bold', marginTop: '4px' }} disabled={busy || projectDuration(s.project) <= 0} onClick={() => void start()}>
          {busy ? <LoaderCircle className="spin" /> : <Download style={{ width: 13 }} />} 비디오 렌더링 내보내기
        </button>
      </div> :
      <div className={`export-status ${job.status}`} style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '10px 0 4px', textAlign: 'center' }}>
        <div className="status-icon" style={{ margin: '4px auto 0', display: 'grid', placeItems: 'center', width: '48px', height: '48px', borderRadius: '50%', background: 'var(--card-bg)', color: 'var(--accent-cyan)', border: '1px solid var(--line)' }}>
          {job.status === 'complete' ? <Check style={{ width: 24, height: 24, color: 'var(--success)' }} /> : job.status === 'error' ? <X style={{ width: 24, height: 24, color: 'var(--danger)' }} /> : <LoaderCircle className={terminal(job.status) ? '' : 'spin'} style={{ width: 24, height: 24 }} />}
        </div>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: '700', color: 'var(--text)' }}>
            {job.status === 'complete' ? '비디오 렌더링 완료!' : job.status === 'error' ? '내보내기 실패' : '비디오 렌더링 진행 중...'}
          </h3>
          {job.error && <p style={{ color: 'var(--danger)', fontSize: '11.5px', margin: '4px 0 0' }}>{job.error}</p>}
        </div>

        {!terminal(job.status) && <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', margin: '4px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', fontWeight: '600', color: 'var(--muted)' }}>
            <span>렌더링 진행률</span>
            <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: '700' }}>{Math.round(job.progress)}%</span>
          </div>
          <progress max="100" value={job.progress} style={{ width: '100%', height: '8px', borderRadius: '4px', overflow: 'hidden' }} />
        </div>}

        <div style={{ marginTop: '4px' }}>
          {job.status === 'complete' ? (
            <a className="primary wide" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', height: '38px', borderRadius: '8px', textDecoration: 'none', fontWeight: 'bold' }} href={job.downloadUrl || api.downloadUrl(job.id)} download={`${exportName.trim() || '내_비디오_프로젝트'}.${format}`}>
              <Download style={{ width: 15 }} /> {format.toUpperCase()} 비디오 다운로드
            </a>
          ) : !terminal(job.status) ? (
            <button className="tool-button wide" style={{ height: '36px', borderRadius: '8px', justifyContent: 'center' }} onClick={() => void cancelCurrentJob()}>
              <X style={{ width: 14 }} /> 렌더링 취소
            </button>
          ) : (
            <button className="tool-button wide" style={{ height: '36px', borderRadius: '8px', justifyContent: 'center' }} onClick={close}>
              닫기
            </button>
          )}
        </div>
      </div>}
    </div>
  </div>;
}

function MediaContextMenu({ x, y, mediaId, close, confirmDelete }: { x: number; y: number; mediaId: string; close: () => void; confirmDelete: (id: string) => void }) {
  const s = useEditorStore();
  useEffect(() => {
    const handleDown = () => close();
    window.addEventListener('pointerdown', handleDown);
    return () => window.removeEventListener('pointerdown', handleDown);
  }, [close]);

  const safeX = Math.max(10, Math.min(x, window.innerWidth - 220));
  const safeY = Math.max(10, Math.min(y, window.innerHeight - 240));

  return <div className="context-menu" style={{ left: safeX, top: safeY }} onPointerDown={(e) => e.stopPropagation()}>
    <button className="context-menu-item" onClick={() => { s.addClip(mediaId); close(); }}><Plus /> 타임라인 트랙 추가</button>
    <button className="context-menu-item" onClick={() => { s.addOverlayClip(mediaId); close(); }}><Maximize2 /> 오버레이 트랙(PIP) 추가</button>
    <button className="context-menu-item" onClick={() => { s.addAudioClip(mediaId); close(); }}><Volume2 /> 오디오 트랙 추가</button>
    <div className="context-menu-divider" />
    <button className="context-menu-item danger" onClick={() => { confirmDelete(mediaId); close(); }}><Trash2 /> 미디어 삭제</button>
  </div>;
}

function ConfirmDeleteModal({ mediaId, close }: { mediaId: string; close: () => void }) {
  const s = useEditorStore();
  const media = s.project.media[mediaId];
  const filename = media?.originalName || media?.name || '미디어';
  return <div className="modal-backdrop" role="presentation" onPointerDown={e => e.target === e.currentTarget && close()}>
    <div className="modal">
      <div className="modal-header">
        <h2 style={{ color: 'var(--danger)', margin: 0, padding: 0, fontSize: '16px' }}>미디어 삭제 확인</h2>
      </div>
      <p style={{ margin: '4px 0 0 0', padding: 0, color: 'var(--text)' }}>
        <strong style={{ color: 'var(--text)', fontSize: '13.5px' }}>[{filename}]</strong>를 라이브러리에서 삭제하시겠습니까?<br />
        <small style={{ color: 'var(--muted)', display: 'block', marginTop: '4px', fontSize: '11.5px' }}>
          타임라인의 모든 연관 클립도 함께 삭제됩니다.
        </small>
      </p>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
        <button className="tool-button" style={{ padding: '7px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '600' }} onClick={close}>
          취소
        </button>
        <button className="tool-button danger" style={{ padding: '7px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: '700', background: 'linear-gradient(135deg, #ef4444, #dc2626)', border: 'none', color: '#fff' }} onClick={() => { s.deleteMedia(mediaId); close(); }}>
          <Trash2 style={{ width: 14 }} /> 삭제하기
        </button>
      </div>
    </div>
  </div>;
}

function ConfirmNewProjectModal({ close, confirm }: { close: () => void; confirm: () => void }) {
  return <div className="modal-backdrop" role="presentation" onPointerDown={e => e.target === e.currentTarget && close()}>
    <div className="modal">
      <div className="modal-header">
        <h2 style={{ color: 'var(--accent-cyan)', margin: 0, padding: 0, fontSize: '16px' }}>새 프로젝트 시작</h2>
      </div>
      <p style={{ margin: '4px 0 0 0', padding: 0, color: 'var(--text)' }}>
        새 프로젝트를 시작하시겠습니까?<br />
        <strong style={{ color: 'var(--danger)', display: 'block', marginTop: '4px', fontSize: '12px' }}>
          ⚠️ 현재 프로젝트의 모든 편집 내역이 초기화됩니다.
        </strong>
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
        <button className="secondary" style={{ padding: '7px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }} onClick={close}>
          취소
        </button>
        <button className="primary" style={{ background: 'linear-gradient(135deg, #06b6d4, #0891b2)', border: 'none', padding: '7px 18px', borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: '700' }} onClick={() => { confirm(); close(); }}>
          <FilePlus style={{ width: 14 }} /> 시작하기
        </button>
      </div>
    </div>
  </div>;
}

export default function App() {
  const s = useEditorStore();
  const [exportOpen, setExportOpen] = useState(false); const notice = s.notice;
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; clipId?: string }>({ visible: false, x: 0, y: 0 });
  const [canvasContextMenu, setCanvasContextMenu] = useState<{ visible: boolean; x: number; y: number; clipId?: string }>({ visible: false, x: 0, y: 0 });
  const [mediaContextMenu, setMediaContextMenu] = useState<{ visible: boolean; x: number; y: number; mediaId?: string }>({ visible: false, x: 0, y: 0 });
  const [trackContextMenu, setTrackContextMenu] = useState<{ visible: boolean; x: number; y: number; trackId?: string }>({ visible: false, x: 0, y: 0 });
  const [confirmDeleteMediaId, setConfirmDeleteMediaId] = useState<string | null>(null);
  const [selectTrackMediaId, setSelectTrackMediaId] = useState<string | null>(null);
  const [showConfirmNewProject, setShowConfirmNewProject] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      useEditorStore.setState({ notice: undefined });
    }, 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    document.body.className = s.theme === 'light' ? 'light-theme' : 'dark-theme';
    document.body.setAttribute('data-theme', s.theme);
  }, [s.theme]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target; if (target instanceof HTMLElement && target.matches('input,select,textarea,[contenteditable="true"]')) return; const modifier = e.ctrlKey || e.metaKey; if (e.code === 'Space') { e.preventDefault(); useEditorStore.setState(s => ({ playing: !s.playing })) } else if (modifier && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? useEditorStore.getState().redo() : useEditorStore.getState().undo() } else if (modifier && e.key.toLowerCase() === 'y') { e.preventDefault(); useEditorStore.getState().redo() } else if (modifier && e.key.toLowerCase() === 'c') { e.preventDefault(); useEditorStore.getState().copyClip() } else if (modifier && e.key.toLowerCase() === 'x') { e.preventDefault(); useEditorStore.getState().cutClip() } else if (modifier && e.key.toLowerCase() === 'v') { e.preventDefault(); useEditorStore.getState().pasteClip() } else if (e.key.toLowerCase() === 's') { useEditorStore.getState().split() } else if (e.key.toLowerCase() === 'g') { useEditorStore.getState().ripple() } else if (e.key === 'Delete' || e.key === 'Backspace') useEditorStore.getState().remove()
    }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, []);

  const openContextMenu = (e: React.MouseEvent, clipId?: string) => {
    e.preventDefault(); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, clipId });
  };
  const openCanvasContextMenu = (e: React.MouseEvent, clipId: string) => {
    e.preventDefault(); setCanvasContextMenu({ visible: true, x: e.clientX, y: e.clientY, clipId });
  };
  const openMediaContextMenu = (e: React.MouseEvent, mediaId: string) => {
    e.preventDefault(); setMediaContextMenu({ visible: true, x: e.clientX, y: e.clientY, mediaId });
  };
  const openTrackContextMenu = (e: React.MouseEvent, trackId: string) => {
    e.preventDefault(); setTrackContextMenu({ visible: true, x: e.clientX, y: e.clientY, trackId });
  };

  const handleSelectMedia = (_mediaId: string) => {
    useEditorStore.setState({ selectedTrackId: undefined, selectedClipId: undefined });
  };

  const handleAddMediaToTrack = (mediaId: string) => {
    setSelectTrackMediaId(mediaId);
  };

  return <div className="app">
    <Topbar openExport={() => setExportOpen(true)} confirmNewProject={() => setShowConfirmNewProject(true)} />
    <div className="workbench">
      <MediaLibrary openContextMenu={openMediaContextMenu} confirmDelete={(id) => setConfirmDeleteMediaId(id)} onSelectMedia={handleSelectMedia} onAddMediaToTrack={handleAddMediaToTrack} />
      <Stage openCanvasContextMenu={openCanvasContextMenu} />
      <Inspector />
    </div>
    <Timeline openContextMenu={openContextMenu} openTrackContextMenu={openTrackContextMenu} />
    {notice && <button role="alert" aria-live="assertive" className={`toast ${notice.kind}`} onClick={() => useEditorStore.setState({ notice: undefined })}>{notice.message}</button>}
    {exportOpen && <ExportModal close={() => setExportOpen(false)} />}
    {s.showSettingsModal && <SettingsModal close={() => s.setShowSettingsModal(false)} />}
    {contextMenu.visible && <ContextMenu x={contextMenu.x} y={contextMenu.y} clipId={contextMenu.clipId} close={() => setContextMenu({ visible: false, x: 0, y: 0 })} />}
    {canvasContextMenu.visible && canvasContextMenu.clipId && <CanvasContextMenu x={canvasContextMenu.x} y={canvasContextMenu.y} clipId={canvasContextMenu.clipId} close={() => setCanvasContextMenu({ visible: false, x: 0, y: 0 })} />}
    {mediaContextMenu.visible && mediaContextMenu.mediaId && <MediaContextMenu x={mediaContextMenu.x} y={mediaContextMenu.y} mediaId={mediaContextMenu.mediaId} close={() => setMediaContextMenu({ visible: false, x: 0, y: 0 })} confirmDelete={(id) => setConfirmDeleteMediaId(id)} />}
    {trackContextMenu.visible && trackContextMenu.trackId && <TrackContextMenu x={trackContextMenu.x} y={trackContextMenu.y} trackId={trackContextMenu.trackId} close={() => setTrackContextMenu({ visible: false, x: 0, y: 0 })} />}
    {confirmDeleteMediaId && <ConfirmDeleteModal mediaId={confirmDeleteMediaId} close={() => setConfirmDeleteMediaId(null)} />}
    {selectTrackMediaId && <SelectTrackModal mediaId={selectTrackMediaId} close={() => setSelectTrackMediaId(null)} />}
    {showConfirmNewProject && <ConfirmNewProjectModal close={() => setShowConfirmNewProject(false)} confirm={() => useEditorStore.getState().newProject()} />}
  </div>;
}

function SettingsModal({ close }: { close: () => void }) {
  const s = useEditorStore();
  return <div className="modal-backdrop" role="presentation" onPointerDown={e => e.target === e.currentTarget && close()}>
    <div className="modal" style={{ width: '360px' }}>
      <div className="modal-header">
        <div><h2>설정</h2></div>
        <button className="icon-button" onClick={close}><X /></button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', margin: '16px 0' }}>
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>화면 테마</label>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: '1.4' }}>Cadria Studio의 UI 색상 테마를 선택합니다.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button
              className={`tool-button ${s.theme === 'dark' ? 'selected' : ''}`}
              style={{ justifyContent: 'center', height: '38px', fontWeight: 600, background: s.theme === 'dark' ? '#06b6d4' : 'var(--panel-bg)', color: s.theme === 'dark' ? '#fff' : 'var(--text)', border: '1px solid var(--line)' }}
              onClick={() => s.setTheme('dark')}
            >
              🌙 다크 모드
            </button>
            <button
              className={`tool-button ${s.theme === 'light' ? 'selected' : ''}`}
              style={{ justifyContent: 'center', height: '38px', fontWeight: 600, background: s.theme === 'light' ? '#06b6d4' : 'var(--panel-bg)', color: s.theme === 'light' ? '#fff' : 'var(--text)', border: '1px solid var(--line)' }}
              onClick={() => s.setTheme('light')}
            >
              ☀️ 화이트 모드
            </button>
          </div>
        </div>
      </div>
      <div className="modal-actions" style={{ justifyContent: 'flex-end', marginTop: '20px' }}>
        <button className="export-button" onClick={close}>확인</button>
      </div>
    </div>
  </div>;
}
