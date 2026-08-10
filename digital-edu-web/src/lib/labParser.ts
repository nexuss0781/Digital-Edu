import type { LabHint, LabStoryHint, LabUserStory, Rewrite } from '@/types';
import { type Workspace, stripEditableRegions } from './workshopParser';
import { applyRewrites } from './offlineAssets';

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'hint' | 'hint-pass';
  text: string;
  time: number;
}

const STORIES_HEADING_RE = /^\*\*User Stories?\s*(?:\(excerpt\))?:\*\*\s*$/i;
const NUMBERED_ITEM_RE = /^\s*(\d+)\.\s+(.*)$/;

export function parseUserStories(description: string): LabUserStory[] {
  const lines = description.split('\n');
  const blocks: string[] = [];
  let inStories = false;
  let current: string[] = [];

  const flush = () => {
    if (current.length) {
      blocks.push(current.join('\n').trim());
      current = [];
    }
  };

  for (const line of lines) {
    if (STORIES_HEADING_RE.test(line)) {
      inStories = true;
      continue;
    }
    if (!inStories) continue;

    const item = line.match(NUMBERED_ITEM_RE);
    if (item) {
      flush();
      current = [item[2].trim()];
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      if (current.length) current.push(line.trim());
      continue;
    }
    if (line.trim() === '') continue;
    if (/^\*\*/.test(line.trim())) break;
    if (current.length) current.push(line.trim());
  }
  flush();

  if (blocks.length === 0) {
    let fallback: string[] = [];
    let acc: string[] = [];
    for (const line of lines) {
      const item = line.match(NUMBERED_ITEM_RE);
      if (item) {
        if (acc.length) fallback.push(acc.join('\n'));
        acc = [item[2].trim()];
      } else if (/^\s*[-*]\s+/.test(line)) {
        if (acc.length) acc.push(line.trim());
      } else if (line.trim() === '') {
        if (acc.length) fallback.push(acc.join('\n'));
        acc = [];
      }
    }
    if (acc.length) fallback.push(acc.join('\n'));
    blocks.push(...fallback);
  }

  return blocks.map((text, i) => ({
    id: `s${i + 1}`,
    text,
    passed: false,
    checked: false,
  }));
}

function tokens(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/`/g, ' ')
    .replace(/[^a-z0-9.#-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return new Set(words);
}

export function assignHintsToStories(
  stories: LabUserStory[],
  hints: LabHint[],
  overrides: LabStoryHint[] = []
): LabStoryHint[] {
  if (stories.length === 0 || hints.length === 0) return [];
  if (overrides.length > 0) return overrides;

  const storyTokens = stories.map((s) => tokens(s.text));
  const result: LabStoryHint[] = stories.map((s) => ({ storyId: s.id, hintIds: [] }));

  hints.forEach((hint, hi) => {
    const ht = tokens(hint.text);
    let best = -1;
    let bestScore = 0;
    if (ht.size > 0) {
      storyTokens.forEach((st, si) => {
        let score = 0;
        ht.forEach((t) => {
          if (st.has(t)) score++;
        });
        if (score > bestScore) {
          bestScore = score;
          best = si;
        }
      });
    }
    const target =
      best >= 0 ? best : Math.min(stories.length - 1, Math.floor((hi * stories.length) / hints.length));
    result[target].hintIds.push(hint.id);
  });

  return result;
}

const CONSOLE_FWD_SCRIPT = `(function () {
  var parent = window.parent;
  function send(level) {
    return function () {
      try {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i];
          if (a === null) parts.push('null');
          else if (a === undefined) parts.push('undefined');
          else if (typeof a === 'object') {
            try { parts.push(JSON.stringify(a)); } catch (e) { parts.push(String(a)); }
          } else parts.push(String(a));
        }
        parent.postMessage({ source: 'digitaledu-console', level: level, text: parts.join(' ') }, '*');
      } catch (e) {}
    };
  }
  ['log', 'info', 'warn', 'error'].forEach(function (lv) {
    try { window.console[lv] = send(lv); } catch (e) {}
  });
  window.addEventListener('error', function (ev) {
    try {
      parent.postMessage({ source: 'digitaledu-console', level: 'error', text: String(ev.message) }, '*');
    } catch (e) {}
  });
})();`;

function resolveAssets(code: string, assetBase?: string): string {
  return assetBase ? code.split('../assets/').join(`${assetBase}/`) : code;
}

export function buildLabSrcDoc(ws: Workspace, assetBase?: string, rewrites?: Rewrite[]): string {
  const html = resolveAssets(applyRewrites(ws.html, rewrites), assetBase);
  const css = resolveAssets(applyRewrites(ws.css, rewrites), assetBase);
  const js = resolveAssets(applyRewrites(ws.js, rewrites), assetBase);
  const style = css ? `<style>\n${css}\n</style>` : '';
  const script = js ? `<script>\n${js}\n<\/script>` : '';
  const headExtra = `<script>\n${CONSOLE_FWD_SCRIPT}\n<\/script>\n${style}`;
  const hasFullDoc = /<\/(head|html)>/i.test(html) || /<html[\s>]/i.test(html);

  if (hasFullDoc) {
    let doc = html;
    if (headExtra) {
      if (/<head[^>]*>/i.test(doc)) {
        doc = doc.replace(/<head[^>]*>/i, (m) => `${m}\n${headExtra}`);
      } else if (/<html[^>]*>/i.test(doc)) {
        doc = doc.replace(/<html[^>]*>/i, (m) => `${m}\n<head>\n${headExtra}\n</head>`);
      } else {
        doc = `${headExtra}\n${doc}`;
      }
    }
    if (script) {
      if (/<\/body>/i.test(doc)) doc = doc.replace(/<\/body>/i, `${script}\n</body>`);
      else doc = `${doc}\n${script}`;
    }
    return doc;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${headExtra}
</head>
<body>
${stripEditableRegions(html)}
${script}
</body>
</html>`;
}

export function normalizeHints(hints: { text: string; code: string }[]): LabHint[] {
  return hints.map((h, i) => ({
    id: `h${i + 1}`,
    text: h.text,
    testCode: h.code,
  }));
}
