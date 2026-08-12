function splitAtempo(speed) {
  if (speed < 0.1 || speed > 16) throw new Error("Speed must be between 0.1 and 16");
  const factors = [];
  let remaining = speed;
  while (remaining > 2) {
    factors.push(2.0);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  factors.push(Math.round(remaining * 1000000) / 1000000);
  return factors;
}

function numStr(val) {
  const num = Number(val ?? 0);
  return (isNaN(num) ? 0 : num).toFixed(6);
}

function evenInt(val) {
  const rounded = Math.max(2, Math.round(val ?? 2));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function buildFfmpegPlan(project, resolvedMediaMap, outputPath) {
  const clips = [];
  for (const track of project.tracks || []) {
    for (const clip of track.clips || []) {
      clips.push({ track, clip });
    }
  }

  if (clips.length === 0) {
    throw new Error("No clips to export");
  }

  let maxDuration = 0;
  for (const { clip } of clips) {
    const sStart = clip.sourceStart ?? clip.source_start ?? 0;
    const sEnd = clip.sourceEnd ?? clip.source_end ?? 0;
    const tStart = clip.timelineStart ?? clip.timeline_start ?? 0;
    const speed = clip.speed || 1;
    const outDur = (sEnd - sStart) / speed;
    const endPos = tStart + outDur;
    if (endPos > maxDuration) maxDuration = endPos;
  }

  const mediaIds = Array.from(new Set(clips.map(c => c.clip.media_id || c.clip.mediaId)));
  const blurId = project.background?.blur_source_id || project.background?.blurSourceId;
  if (blurId && !mediaIds.includes(blurId)) {
    mediaIds.push(blurId);
  }

  const inputIndexMap = {};
  mediaIds.forEach((id, idx) => { inputIndexMap[id] = idx; });

  const inputs = mediaIds.map(id => {
    const mediaObj = resolvedMediaMap[id];
    if (!mediaObj) throw new Error(`Missing media file for ID: ${id}`);
    if (mediaObj.metadata?.is_image) {
      // 이미지는 -loop 1로 무한 반복 후 타임라인 길이만큼 자름
      return ['-loop', '1', '-framerate', '30', '-i', mediaObj.path];
    }
    return ['-i', mediaObj.path];
  });

  const filters = [];
  let labelCounter = 0;
  function nextLabel(prefix) {
    labelCounter++;
    return `${prefix}${labelCounter}`;
  }

  const exportSettings = project.export || {};
  const width = exportSettings.width || 1920;
  const height = exportSettings.height || 1080;
  const totalDurationStr = numStr(maxDuration);
  const bg = project.background || { type: 'solid', color: '#000000' };
  const color1 = (bg.color || '#000000').replace('#', '');

  if (bg.type === 'gradient') {
    const color2 = (bg.color2 || '#1a1a2e').replace('#', '');
    filters.push(
      `color=c=0x${color1}:s=${width}x${height}:d=${totalDurationStr}[g1]`,
      `color=c=0x${color2}:s=${width}x${height}:d=${totalDurationStr}[g2]`,
      `[g1][g2]blend=all_expr='A*(1-Y/H)+B*(Y/H)'[bg]`
    );
  } else if (bg.type === 'blur' && blurId) {
    const bIdx = inputIndexMap[blurId];
    const radius = bg.blur_radius || bg.blur || 20;
    filters.push(
      `[${bIdx}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=${numStr(radius)}:5,setsar=1,tpad=stop_mode=clone:stop_duration=${totalDurationStr}[bg]`
    );
  } else {
    filters.push(`color=c=0x${color1}:s=${width}x${height}:d=${totalDurationStr}[bg]`);
  }

  const visualOverlays = [];
  const audioLabels = [];

  for (const { track, clip } of clips) {
    const mId = clip.media_id || clip.mediaId;
    const idx = inputIndexMap[mId];
    const sStart = clip.sourceStart ?? clip.source_start ?? 0;
    const sEnd = clip.sourceEnd ?? clip.source_end ?? 0;
    const tStart = clip.timelineStart ?? clip.timeline_start ?? 0;
    const speed = clip.speed || 1;
    const startStr = numStr(sStart);
    const endStr = numStr(sEnd);
    const tStartStr = numStr(tStart);
    const outDur = (sEnd - sStart) / speed;

    if (track.type !== 'audio' && track.kind !== 'audio') {
      let curr = nextLabel('trim');
      filters.push(`[${idx}:v]trim=start=${startStr}:end=${endStr},setpts=PTS-STARTPTS[${curr}]`);

      const crop = clip.crop || {};
      if (crop.x || crop.y || (crop.w && crop.w < 1) || (crop.h && crop.h < 1)) {
        const cw = crop.w || crop.width || 1;
        const ch = crop.h || crop.height || 1;
        const cx = crop.x || 0;
        const cy = crop.y || 0;
        const cropped = nextLabel('crop');
        filters.push(`[${curr}]crop=iw*${numStr(cw)}:ih*${numStr(ch)}:iw*${numStr(cx)}:ih*${numStr(cy)}[${cropped}]`);
        curr = cropped;
      }

      const tf = clip.transform || {};
      const ops = [];
      if (tf.flip_x || tf.flipX) ops.push('hflip');
      if (tf.flip_y || tf.flipY) ops.push('vflip');
      if (tf.rotation === 90) ops.push('transpose=1');
      else if (tf.rotation === 180) ops.push('hflip,vflip');
      else if (tf.rotation === 270) ops.push('transpose=2');

      if (ops.length > 0) {
        const oriented = nextLabel('orient');
        filters.push(`[${curr}]${ops.join(',')}[${oriented}]`);
        curr = oriented;
      }

      if (speed !== 1) {
        const sped = nextLabel('speed');
        filters.push(`[${curr}]setpts=PTS/${numStr(speed)}[${sped}]`);
        curr = sped;
      }

      const scale = tf.scale || 1;
      const tfW = tf.width || 1;
      const tfH = tf.height || 1;
      const targetW = evenInt(tfW * width * scale);
      const targetH = evenInt(tfH * height * scale);

      const scaled = nextLabel('scale');
      filters.push(`[${curr}]scale=${targetW}:${targetH},setsar=1,format=rgba[${scaled}]`);
      curr = scaled;

      const pos = nextLabel('position');
      filters.push(`[${curr}]setpts=PTS-STARTPTS+${tStartStr}/TB[${pos}]`);

      const posX = Math.round((tf.x || 0) * width);
      const posY = Math.round((tf.y || 0) * height);
      const tStart = clip.timeline_start || 0;
      visualOverlays.push({
        isOverlay: (track.type === 'overlay' || track.kind === 'overlay') ? 1 : 0,
        timelineStart: tStart,
        label: pos,
        x: posX,
        y: posY,
        start: tStart,
        end: tStart + outDur
      });
    }

    const metaObj = resolvedMediaMap[mId]?.metadata || {};
    const audio = clip.audio || { enabled: true, volume: 1, mute: false };
    if (metaObj.has_audio && !track.muted && audio.enabled && !audio.mute && (audio.volume || 1) > 0) {
      let currA = nextLabel('atrim');
      filters.push(`[${idx}:a]atrim=start=${startStr}:end=${endStr},asetpts=PTS-STARTPTS,aresample=48000[${currA}]`);

      if (speed !== 1) {
        const factors = splitAtempo(speed);
        for (const factor of factors) {
          const adj = nextLabel('atempo');
          filters.push(`[${currA}]atempo=${numStr(factor)}[${adj}]`);
          currA = adj;
        }
      }

      const vol = audio.volume !== undefined ? audio.volume : 1;
      if (vol !== 1) {
        const volLabel = nextLabel('volume');
        filters.push(`[${currA}]volume=${numStr(vol)}[${volLabel}]`);
        currA = volLabel;
      }

      const delayMs = Math.round((clip.timeline_start || 0) * 1000);
      const delayed = nextLabel('delay');
      filters.push(`[${currA}]adelay=${delayMs}|${delayMs}[${delayed}]`);
      audioLabels.push(delayed);
    }
  }

  visualOverlays.sort((a, b) => {
    if (a.isOverlay !== b.isOverlay) return a.isOverlay - b.isOverlay;
    return a.timelineStart - b.timelineStart;
  });

  let base = 'bg';
  visualOverlays.forEach((vo, idx) => {
    const isLast = idx === visualOverlays.length - 1;
    const resLabel = isLast ? 'vcomposed' : nextLabel('overlay');
    filters.push(
      `[${base}][${vo.label}]overlay=x=${vo.x}:y=${vo.y}:eof_action=pass:enable='between(t\\,${numStr(vo.start)}\\,${numStr(vo.end)})'[${resLabel}]`
    );
    base = resLabel;
  });

  const fps = exportSettings.fps || 30;
  filters.push(`[${base}]trim=duration=${totalDurationStr},setpts=PTS-STARTPTS,fps=${fps},format=yuv420p[vout]`);

  let hasExtraAudioInput = false;
  if (audioLabels.length === 1) {
    filters.push(`[${audioLabels[0]}]atrim=duration=${totalDurationStr},asetpts=PTS-STARTPTS[aout]`);
  } else if (audioLabels.length > 1) {
    const joined = audioLabels.map(l => `[${l}]`).join('');
    filters.push(`${joined}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0,atrim=duration=${totalDurationStr},asetpts=PTS-STARTPTS[aout]`);
  } else {
    hasExtraAudioInput = true;
    inputs.push(['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000']);
    const nullIdx = inputs.length - 1;
    filters.push(`[${nullIdx}:a]atrim=duration=${totalDurationStr},asetpts=PTS-STARTPTS[aout]`);
  }

  const qualityPreset = {
    draft: ['veryfast', '28'],
    standard: ['medium', '23'],
    high: ['slow', '18']
  }[exportSettings.quality || 'standard'] || ['medium', '23'];

  const argv = ['-hide_banner', '-nostdin'];
  inputs.forEach(inp => argv.push(...inp));

  argv.push(
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', exportSettings.video_codec || 'libx264',
    '-preset', qualityPreset[0],
    '-crf', qualityPreset[1],
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', exportSettings.audio_bitrate || '192k',
    '-movflags', '+faststart',
    '-t', totalDurationStr,
    '-progress', 'pipe:1',
    '-nostats',
    '-y',
    outputPath
  );

  return { argv, duration: maxDuration };
}

module.exports = { buildFfmpegPlan };
