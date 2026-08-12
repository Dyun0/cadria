import type { Media, ProjectV1 } from '../core/types';

export interface ExportJob { id: string; status: 'queued' | 'processing' | 'complete' | 'cancelled' | 'error'; progress: number; error?: string; downloadUrl?: string }
export interface WebApiTransport {
  upload(file: File, signal?: AbortSignal): Promise<Media>;
  createExport(project: ProjectV1, signal?: AbortSignal): Promise<ExportJob>;
  getExport(id: string, signal?: AbortSignal): Promise<ExportJob>;
  watchExport(id: string, onUpdate: (job: ExportJob) => void): () => void;
  cancelExport(id: string): Promise<void>;
  downloadUrl(id: string): string;
}

async function json<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = await response.json().catch(() => ({}));
  const detail = Array.isArray(body.detail)
    ? body.detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join(', ')
    : body.detail;
  if (!response.ok) throw new Error(body.error || detail || `요청 실패 (${response.status})`);
  return body;
}

const normalizeJob = (data: Record<string, unknown>): ExportJob => {
  const statusMap: Record<string, ExportJob['status']> = {
    queued: 'queued', running: 'processing', completed: 'complete',
    failed: 'error', cancelled: 'cancelled',
  };
  const rawProgress = Number(data.progress ?? 0);
  return {
    id: String(data.id ?? data.jobId),
    status: statusMap[String(data.status)] ?? data.status as ExportJob['status'],
    progress: rawProgress <= 1 ? rawProgress * 100 : rawProgress,
    error: data.error ? String(data.error) : undefined,
    downloadUrl: data.downloadUrl ? String(data.downloadUrl) : undefined,
  };
};

const normalizeMedia = (data: Record<string, unknown>): Media => ({
  id: String(data.id ?? data.fileId ?? data.media_id),
  name: String(data.original_name ?? data.originalName ?? data.name ?? '미디어'),
  originalName: String(data.original_name ?? data.originalName ?? data.name ?? '미디어'),
  url: String(data.url), duration: Number(data.duration), width: Number(data.width ?? 1920),
  height: Number(data.height ?? 1080), mimeType: String(data.mimeType ?? 'video/mp4'),
  hasAudio: data.hasAudio !== false,
  thumbnailUrl: data.thumbnailUrl || data.thumbnail_url ? String(data.thumbnailUrl ?? data.thumbnail_url) : undefined,
  serverFilename: data.filename ? String(data.filename) : undefined,
});

export class FetchWebApiTransport implements WebApiTransport {
  async upload(file: File, signal?: AbortSignal) {
    const form = new FormData(); form.append('media', file);
    return normalizeMedia(await json<Record<string, unknown>>('/api/media', { method: 'POST', body: form, signal }));
  }
  async createExport(project: ProjectV1, signal?: AbortSignal) {
    return normalizeJob(await json<Record<string, unknown>>('/api/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project }), signal }));
  }
  async getExport(id: string, signal?: AbortSignal) { return normalizeJob(await json<Record<string, unknown>>(`/api/exports/${id}`, { signal })); }
  watchExport(id: string, onUpdate: (job: ExportJob) => void) {
    let stopped = false; let timer = 0; const source = new EventSource(`/api/exports/${id}/events`);
    const poll = async () => {
      if (stopped) return;
      try { const job = await this.getExport(id); onUpdate(job); if (!['complete', 'cancelled', 'error'].includes(job.status)) timer = window.setTimeout(poll, 1000); } catch { timer = window.setTimeout(poll, 2000); }
    };
    const handle = (event: MessageEvent) => onUpdate(normalizeJob(JSON.parse(event.data)));
    source.addEventListener('status', handle as EventListener);
    source.onmessage = handle;
    source.onerror = () => { source.close(); poll(); };
    return () => { stopped = true; source.close(); clearTimeout(timer); };
  }
  async cancelExport(id: string) { await json(`/api/exports/${id}`, { method: 'DELETE' }); }
  downloadUrl(id: string) { return `/api/exports/${id}/download`; }
}

export const api: WebApiTransport = new FetchWebApiTransport();
