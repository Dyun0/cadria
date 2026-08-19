export const SUBTITLE_FONTS = [
  { id: 'gowun-dodum', name: '고운돋움', family: 'CadriaGowunDodum', file: 'GowunDodum-Regular.ttf' },
  { id: 'gowun-batang', name: '고운바탕', family: 'CadriaGowunBatang', file: 'GowunBatang-Regular.ttf' },
  { id: 'jua', name: '주아', family: 'CadriaJua', file: 'Jua-Regular.ttf' },
  { id: 'do-hyeon', name: '도현', family: 'CadriaDoHyeon', file: 'DoHyeon-Regular.ttf' },
  { id: 'noto-sans', name: 'Noto Sans KR', family: 'CadriaNotoSans', file: 'NotoSansKR-Regular.ttf' },
] as const;

export type SubtitleFontId = (typeof SUBTITLE_FONTS)[number]['id'];

export const DEFAULT_SUBTITLE_FONT_ID: SubtitleFontId = 'gowun-dodum';

export function subtitleFontFamily(fontId?: string) {
  return SUBTITLE_FONTS.find((font) => font.id === fontId)?.family ?? 'CadriaGowunDodum';
}
