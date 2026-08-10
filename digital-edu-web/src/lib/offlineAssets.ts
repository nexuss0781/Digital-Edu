import type { Rewrite } from '@/types';

/** Apply remote->local rewrites to arbitrary text (HTML/CSS/JS seeds). */
export function applyRewrites(text: string, rewrites?: Rewrite[]): string {
  if (!rewrites || rewrites.length === 0) return text;
  let out = text;
  for (const r of rewrites) {
    if (r.from && r.to && r.from !== r.to) out = out.split(r.from).join(r.to);
  }
  return out;
}

/** Rewrite a single URL (used for lecture description images). */
export function rewriteUrl(url: string, rewrites?: Rewrite[]): string {
  if (!rewrites || rewrites.length === 0 || !url) return url;
  for (const r of rewrites) {
    if (r.from && url === r.from) return r.to;
  }
  return url;
}
