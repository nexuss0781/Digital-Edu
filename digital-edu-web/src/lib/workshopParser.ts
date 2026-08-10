import type { Rewrite } from '@/types';
import { applyRewrites } from './offlineAssets';

export type FileKey = 'html' | 'css' | 'js';

export interface Callout {
  kind: 'note';
  text: string;
}

export interface Marker {
  key: string;
  values: string[];
}

export interface Fence {
  lang: string;
  code: string;
  kind: 'example' | 'literal';
}

export interface ListItem {
  ordered: boolean;
  text: string;
}

export interface ParsedStep {
  step: number;
  title: string;
  markdown: string;
  callouts: Callout[];
  markers: Marker[];
  fences: Fence[];
  listItems: ListItem[];
  inlineTokens: string[];
  emphasisTokens: string[];
  rawTags: string[];
  targetFile: FileKey;
  typeText: string;
}

export interface WorkshopModel {
  id: string;
  block: string;
  dominantFile: FileKey;
  steps: ParsedStep[];
}

const NOTE_RE = /^\*\*(?:Note|NOTE)\*?\*?\s*:?\s*(.*)$/m;
const MARKER_RE = /^\*\*(Value Attributes?|Option Element Text|Option Text):\*\*\s*(.*)$/m;
const FENCE_OPEN_RE = /^```(\w*)\s*$/m;
const ORDERED_ITEM_RE = /^\d+\.\s+.*$/m;
const UNORDERED_ITEM_RE = /^[-*]\s+.*$/m;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const EMPHASIS_RE = /\*([^*\n]+)\*/g;
const RAW_TAG_RE = /<\/?([a-z][a-z0-9]*)\b/gi;

const HTML_TAGS = new Set([
  'a', 'address', 'article', 'aside', 'audio', 'b', 'blockquote', 'body', 'br',
  'button', 'canvas', 'caption', 'cite', 'code', 'colgroup', 'dd', 'dfn', 'div',
  'dl', 'dt', 'em', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1',
  'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'i', 'iframe',
  'img', 'input', 'label', 'legend', 'li', 'link', 'main', 'menu', 'meta', 'nav',
  'ol', 'option', 'p', 'q', 's', 'script', 'section', 'select', 'source', 'span',
  'strong', 'style', 'svg', 'table', 'tbody', 'td', 'textarea', 'tfoot', 'th',
  'thead', 'time', 'title', 'tr', 'track', 'ul', 'var', 'video',
]);

const CSS_TERMS = [
  'css rule', 'css', 'property', 'selector', ':root', '@media', '@keyframes',
  'font-', 'margin', 'padding', 'background', 'border', 'display', 'width',
  'height', 'color', 'flexbox', 'grid', 'class attribute', 'class of',
];

const JS_TERMS = [
  'const', 'let', 'function', '=>', 'array', 'element', 'addEventListener',
  'queryselector', 'variable', 'console', 'forEach', 'map', 'filter',
];

const BLOCK_BIAS: Record<string, FileKey> = {
  'workshop-colored-markers': 'css',
  'workshop-ferris-wheel': 'css',
  'workshop-penguin': 'css',
  'workshop-city-skyline': 'css',
  'workshop-cafe-menu': 'css',
  'workshop-nutritional-label': 'css',
  'workshop-css-photo-gallery': 'css',
  'workshop-flexbox-photo-gallery': 'css',
  'workshop-css-box-model': 'css',
  'workshop-js-music-player': 'js',
  'workshop-cat-photo-app': 'html',
  'workshop-cat-painting': 'html',
  'workshop-bookstore-page': 'html',
  'workshop-curriculum-outline': 'html',
  'workshop-major-browsers-list': 'html',
  'workshop-build-a-heart-icon': 'html',
};

export function blockFromId(id: string): string {
  const match = id.match(/^rwd\/([^/]+)/);
  return match ? match[1] : id;
}

export function dominantFileFor(block: string): FileKey {
  return BLOCK_BIAS[block] || 'html';
}

function extractFences(markdown: string): { fences: Fence[]; typeText: string } {
  const fences: Fence[] = [];
  const lines = markdown.split('\n');
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(FENCE_OPEN_RE);
    if (!open) {
      i++;
      continue;
    }
    const lang = open[1].toLowerCase();
    const code: string[] = [];
    i++;
    while (i < lines.length && !/^```\s*$/.test(lines[i])) {
      code.push(lines[i]);
      i++;
    }
    i++;
    const codeText = code.join('\n').trim();
    const kind: 'example' | 'literal' =
      lang === 'md' || lang === 'markup' ? 'literal' : 'example';
    fences.push({ lang, code: codeText, kind });
  }
  const typeText =
    fences.find((f) => f.kind === 'literal')?.code || '';
  return { fences, typeText };
}

function inferTargetFile(
  markdown: string,
  fences: Fence[],
  dominant: FileKey
): FileKey {
  if (fences.length > 0) {
    const fenceLangs = fences.map((f) => f.lang.toLowerCase());
    if (fenceLangs.includes('css')) return 'css';
    if (fenceLangs.includes('js')) return 'js';
    if (fenceLangs.includes('html')) return 'html';
  }

  const lower = markdown.toLowerCase();
  const tokenText = lower;

  let cssScore = 0;
  let jsScore = 0;
  let htmlScore = 0;

  for (const term of CSS_TERMS) {
    if (tokenText.includes(term)) cssScore++;
  }
  for (const term of JS_TERMS) {
    if (tokenText.includes(term)) jsScore++;
  }

  const tagMatches = tokenText.match(/`([a-z][a-z0-9]*)`/g) || [];
  for (const m of tagMatches) {
    const tag = m.replace(/`/g, '');
    if (HTML_TAGS.has(tag)) htmlScore++;
  }

  if (cssScore > htmlScore && cssScore > jsScore) return 'css';
  if (jsScore > htmlScore && jsScore > cssScore) return 'js';
  if (htmlScore > 0 && htmlScore >= cssScore && htmlScore >= jsScore) return 'html';
  return dominant;
}

function extractMarkerValues(
  lines: string[],
  startIdx: number
): string[] {
  const values: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:\*\*|\d+\.|```|#)/.test(line)) break;
    const m = line.match(/^\s*[-*]\s+(.*)$/);
    if (m) values.push(m[1].trim());
    else if (line.trim() === '') continue;
    else break;
  }
  return values;
}

export function parseStep(
  stepNum: number,
  title: string,
  description: string
): ParsedStep {
  const callouts: Callout[] = [];
  const markers: Marker[] = [];
  const listItems: ListItem[] = [];

  const lines = description.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const note = line.match(NOTE_RE);
    if (note && note[1].trim()) {
      callouts.push({ kind: 'note', text: note[1].trim() });
    }

    const marker = line.match(MARKER_RE);
    if (marker) {
      markers.push({
        key: marker[1],
        values: extractMarkerValues(lines, i),
      });
    }

    if (ORDERED_ITEM_RE.test(line)) {
      listItems.push({ ordered: true, text: line.replace(/^\d+\.\s+/, '').trim() });
    } else if (UNORDERED_ITEM_RE.test(line)) {
      listItems.push({ ordered: false, text: line.replace(/^[-*]\s+/, '').trim() });
    }
  }

  const { fences, typeText } = extractFences(description);

  const inlineTokens: string[] = [];
  let im: RegExpExecArray | null;
  while ((im = INLINE_CODE_RE.exec(description)) !== null) {
    inlineTokens.push(im[1]);
  }

  const emphasisTokens: string[] = [];
  let em: RegExpExecArray | null;
  while ((em = EMPHASIS_RE.exec(description)) !== null) {
    emphasisTokens.push(em[1]);
  }

  const rawTags: string[] = [];
  let rt: RegExpExecArray | null;
  while ((rt = RAW_TAG_RE.exec(description)) !== null) {
    if (rt[1] !== 'dfn') rawTags.push(rt[1]);
  }

  return {
    step: stepNum,
    title,
    markdown: description,
    callouts,
    markers,
    fences,
    listItems,
    inlineTokens,
    emphasisTokens,
    rawTags,
    targetFile: inferTargetFile(description, fences, dominantFileFor('')),
    typeText,
  };
}

export function parseWorkshop(content: {
  id: string;
  steps: { step: number; title: string; description: string }[];
}): WorkshopModel {
  const block = blockFromId(content.id);
  const dominant = dominantFileFor(block);
  const steps = content.steps
    .slice()
    .sort((a, b) => a.step - b.step)
    .map((s) => {
      const parsed = parseStep(s.step, s.title, s.description);
      return { ...parsed, targetFile: inferTargetFile(s.description, parsed.fences, dominant) };
    });
  return { id: content.id, block, dominantFile: dominant, steps };
}

export interface Workspace {
  html: string;
  css: string;
  js: string;
}

export function emptyWorkspace(): Workspace {
  return { html: '', css: '', js: '' };
}

export function stripEditableRegions(code: string): string {
  return code
    .split('\n')
    .filter((line) => !line.includes('--fcc-editable-region--'))
    .join('\n');
}

export function isWorkspaceEmpty(ws: Workspace): boolean {
  return !ws.html.trim() && !ws.css.trim() && !ws.js.trim();
}

export function seedFilesToWorkspace(
  seedFiles?: { language: string; code: string }[]
): Workspace | null {
  if (!seedFiles || seedFiles.length === 0) return null;
  const ws = emptyWorkspace();
  for (const file of seedFiles) {
    const lang = file.language.toLowerCase();
    if (lang === 'html') ws.html = file.code;
    else if (lang === 'css') ws.css = file.code;
    else if (lang === 'js' || lang === 'javascript') ws.js = file.code;
  }
  if (isWorkspaceEmpty(ws)) return null;
  return ws;
}

export function codeForTests(ws: Workspace): string {
  const parts = [ws.html, ws.css, ws.js].filter((p) => p.trim().length > 0);
  return parts.join('\n');
}

export function serializeWorkspace(ws: Workspace): string {
  if (!ws.html && !ws.css && !ws.js) return '';
  return JSON.stringify({ v: 1, ...ws });
}

export function deserializeWorkspace(raw: string | undefined | null): Workspace | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'v' in parsed) {
      return {
        html: typeof parsed.html === 'string' ? parsed.html : '',
        css: typeof parsed.css === 'string' ? parsed.css : '',
        js: typeof parsed.js === 'string' ? parsed.js : '',
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function buildSrcDoc(ws: Workspace, rewrites?: Rewrite[]): string {
  const style = ws.css ? `<style>\n${applyRewrites(ws.css, rewrites)}\n</style>` : '';
  const script = ws.js ? `<script>\n${applyRewrites(ws.js, rewrites)}\n<\/script>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${style}
</head>
<body>
${stripEditableRegions(applyRewrites(ws.html, rewrites))}
${script}
</body>
</html>`;
}

export function fileKeyToLang(key: FileKey): string {
  if (key === 'js') return 'javascript';
  return key;
}
