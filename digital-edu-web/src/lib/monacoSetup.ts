import { loader } from '@monaco-editor/react';

export type Monaco = typeof import('monaco-editor');

let configured = false;

export function initLoader(): Promise<Monaco> {
  if (!configured) {
    configured = true;
    loader.config({
      paths: { vs: '/monaco/vs' },
    });
  }
  return loader.init() as Promise<Monaco>;
}

function cssVar(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) return null;
  const m = value.match(/\d{1,3},\s*\d{1,3},\s*\d{1,3}/);
  if (m) {
    const [r, g, b] = m[0].split(',').map((v) => parseInt(v.trim(), 10));
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  return value;
}

export function defineDigitalEduTheme(instance: Monaco) {
  const card = cssVar('--bg-card') || '#1e2038';
  const bg = card;
  const isLight = (() => {
    const h = bg.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150;
  })();

  const fg = isLight ? '#0F1A3A' : '#E8F0FE';
  const muted = isLight ? '#5B6B8C' : '#64748B';
  const cyan = isLight ? '#005BC5' : '#17F9FF';
  const blue = isLight ? '#005BC5' : '#00B4FC';
  const gold = isLight ? '#B45309' : '#F59E0B';
  const lineHl = isLight ? 'rgba(0,91,197,0.10)' : '#041A5E';
  const cursor = isLight ? '#005BC5' : '#17F9FF';
  const selection = isLight ? 'rgba(0,91,197,0.25)' : '#14446E';
  const inactive = isLight ? 'rgba(0,91,197,0.12)' : '#0D2A4A';
  const lineNum = isLight ? '#7A89A8' : '#9FB1CF';
  const lineNumActive = isLight ? '#005BC5' : '#FFFFFF';
  const guide = isLight ? 'rgba(0,91,197,0.18)' : '#0A1F55';
  const guideActive = isLight ? 'rgba(0,91,197,0.35)' : '#14446E';
  const widgetBg = isLight ? '#FFFFFF' : '#012677';
  const widgetBorder = isLight ? '#D6DFEF' : '#24438C';
  const scrollbar = isLight ? '#C6D2E4' : '#24438C';

  instance.editor.defineTheme('digitaledu-navy', {
    base: isLight ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: fg, background: bg },
      { token: 'comment', foreground: muted, fontStyle: 'italic' },
      { token: 'keyword', foreground: cyan },
      { token: 'keyword.control', foreground: cyan },
      { token: 'string', foreground: blue },
      { token: 'string.quoted', foreground: blue },
      { token: 'number', foreground: gold },
      { token: 'constant', foreground: gold },
      { token: 'variable', foreground: fg },
      { token: 'tag', foreground: cyan },
      { token: 'attribute.name', foreground: blue },
      { token: 'attribute.value', foreground: fg },
      { token: 'delimiter', foreground: isLight ? '#7A89A8' : '#94A3B8' },
      { token: 'operator', foreground: isLight ? '#7A89A8' : '#94A3B8' },
      { token: 'type', foreground: blue },
      { token: 'function', foreground: isLight ? '#005BC5' : '#67E8F9' },
      { token: 'css.property', foreground: blue },
      { token: 'css.value', foreground: gold },
      { token: 'css.selector', foreground: cyan },
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editor.lineHighlightBackground': lineHl,
      'editorLineNumber.foreground': lineNum,
      'editorLineNumber.activeForeground': lineNumActive,
      'editorCursor.foreground': cursor,
      'editor.selectionBackground': selection,
      'editor.inactiveSelectionBackground': inactive,
      'editor.selectionHighlightBackground': inactive,
      'editorIndentGuide.background': guide,
      'editorIndentGuide.activeBackground': guideActive,
      'editorWidget.background': widgetBg,
      'editorWidget.border': widgetBorder,
      'editorSuggestWidget.background': widgetBg,
      'editorSuggestWidget.border': widgetBorder,
      'editorSuggestWidget.selectedBackground': selection,
      'scrollbarSlider.background': `${scrollbar}66`,
      'scrollbarSlider.hoverBackground': `${scrollbar}AA`,
      'scrollbarSlider.activeBackground': `${scrollbar}AA`,
      'minimap.background': bg,
      'input.background': widgetBg,
      'input.border': widgetBorder,
      'focusBorder': cursor,
    },
  });

  instance.editor.setTheme('digitaledu-navy');
}
