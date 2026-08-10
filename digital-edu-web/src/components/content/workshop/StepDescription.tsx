import { useMemo } from 'react';
import { Info, Type, Braces } from 'lucide-react';
import ArticleRenderer from '../ArticleRenderer';
import type { ParsedStep } from '@/lib/workshopParser';
import type { Rewrite } from '@/types';

const NOTE_LINE_RE = /^\*\*(?:Note|NOTE)\*?\*?\s*:?\s*.*$/gm;
const MARKER_LINE_RE = /^\*\*(Value Attributes?|Option Element Text|Option Text):\*\*\s*.*$/gm;
const FENCE_BLOCK_RE = /```\w*\s*\n[\s\S]*?```\s*\n?/gm;

function cleanMarkdown(md: string): string {
  return md.replace(NOTE_LINE_RE, '').replace(MARKER_LINE_RE, '').replace(FENCE_BLOCK_RE, '');
}

function FenceBlock({ lang, code, kind }: { lang: string; code: string; kind: 'example' | 'literal' }) {
  return (
    <div className="overflow-hidden rounded-lg border" style={{ borderColor: '#012677' }}>
      <div className="flex items-center justify-between px-3 py-1.5" style={{ background: '#012677' }}>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#A5C8FF' }}>
          {kind === 'literal' ? <Type size={12} style={{ color: 'var(--color-gold)' }} /> : <Braces size={12} style={{ color: 'var(--color-cyan)' }} />}
          {lang || 'text'} · {kind === 'literal' ? 'type this text' : 'example'}
        </span>
      </div>
      <pre
        className="m-0 overflow-x-auto px-3 py-2.5 text-xs leading-relaxed"
        style={{ background: '#001449', color: '#E8F0FE', fontFamily: 'var(--font-mono)' }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MarkerBlock({ keyText, values }: { keyText: string; values: string[] }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: '#012677', background: 'rgba(1,38,119,0.4)' }}>
      <p className="mb-1.5 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-gold)' }}>
        {keyText}
      </p>
      <ul className="space-y-1">
        {values.map((v, i) => (
          <li key={i} className="text-sm" style={{ color: '#CFE0F8' }}>
            <code style={{ background: 'rgba(23,249,255,0.08)', padding: '0.1em 0.35em', borderRadius: '4px', color: '#17F9FF' }}>{v}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NoteCallout({ text }: { text: string }) {
  return (
    <div className="flex gap-2.5 rounded-lg border p-3" style={{ borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.1)' }}>
      <Info size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--color-gold)' }} />
      <p className="text-sm leading-relaxed" style={{ color: '#CFE0F8' }}>
        {text}
      </p>
    </div>
  );
}

export default function StepDescription({ step, rewrites }: { step: ParsedStep; rewrites?: Rewrite[] }) {
  const md = useMemo(() => cleanMarkdown(step.markdown), [step.markdown]);

  return (
    <div className="space-y-3">
      <ArticleRenderer markdown={md} rewrites={rewrites} />
      {step.fences.map((f, i) => (
        <FenceBlock key={`f-${i}`} lang={f.lang} code={f.code} kind={f.kind} />
      ))}
      {step.markers.map((m, i) => (
        <MarkerBlock key={`m-${i}`} keyText={m.key} values={m.values} />
      ))}
      {step.callouts.map((c, i) => (
        <NoteCallout key={`c-${i}`} text={c.text} />
      ))}
    </div>
  );
}
