import { memo } from 'react';
import { Check, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';
import type { LabState } from '@/hooks/useLab';
import type { LabAsset } from '@/types';
import InlineMarkdown from '../InlineMarkdown';

interface Props {
  state: LabState;
  description: string;
  assets?: LabAsset[];
  onRunChecks: () => void;
  checking: boolean;
}

const STORIES_HEADING_RE = /^\*\*User Stories?\s*(?:\(excerpt\))?:\*\*\s*$/i;

function introFor(description: string): string {
  const lines = description.split('\n');
  const parts: string[] = [];
  for (const line of lines) {
    if (STORIES_HEADING_RE.test(line)) break;
    if (/^\*\*Note\*\*:?/.test(line)) break;
    if (/^\*\*/.test(line.trim()) && parts.length) break;
    if (line.trim() === '') continue;
    parts.push(line.trim());
  }
  return parts.join(' ');
}

function LabDescriptionPaneInner({ state, description, assets = [], onRunChecks, checking }: Props) {
  const { hintStates, allPassed, passedCount } = state;
  const intro = introFor(description);

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: '#001449', userSelect: 'none' }}>
      <div
        className="flex items-center gap-1.5 border-b px-3 py-2"
        style={{ borderColor: 'rgba(23,249,255,0.18)', background: 'rgba(0,20,73,0.6)' }}
      >
        <FileText size={13} style={{ color: 'var(--color-gold)' }} />
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#E8F0FE' }}>
          Tests
        </span>
        <span className="ml-auto text-[11px] font-medium tabular-nums" style={{ color: 'var(--color-gold)' }}>
          {passedCount}/{hintStates.length}
        </span>
      </div>

      <div className="lab-description min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {intro && (
          <div className="mb-3 text-xs leading-relaxed" style={{ color: '#94A3B8' }}>
            <InlineMarkdown text={intro} />
          </div>
        )}

        {assets.length > 0 && (
          <div className="mb-4 rounded-lg border p-2.5" style={{ borderColor: 'rgba(23,249,255,0.18)', background: 'rgba(23,249,255,0.05)' }}>
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: '#E8F0FE' }}>
              <ImageIcon size={11} />
              Resources in this lab
            </p>
            <ul className="space-y-1.5">
              {assets.map((a) => (
                <li key={a.name}>
                  <span className="break-all font-mono text-[11px]" style={{ color: '#E8F0FE' }}>
                    {a.url}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ul className="space-y-2.5">
          {hintStates.map((hint) => (
            <li key={hint.id} className="flex items-start gap-2 text-xs leading-relaxed">
              <span
                className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: hint.passed
                    ? 'rgba(34,197,94,0.18)'
                    : 'rgba(148,163,184,0.12)',
                  color: hint.passed ? '#22c55e' : '#64748B',
                }}
              >
                {hint.passed && <Check size={11} strokeWidth={3} />}
              </span>
              <span style={{ color: hint.passed ? '#A7F3D0' : '#E8F0FE' }}>
                {hint.text}
              </span>
            </li>
          ))}
          {hintStates.length === 0 && (
            <p className="text-xs" style={{ color: '#94A3B8' }}>
              No tests found.
            </p>
          )}
        </ul>
      </div>

      <div
        className="shrink-0 border-t p-3"
        style={{ borderColor: 'rgba(23,249,255,0.18)', background: 'rgba(0,20,73,0.6)' }}
      >
        <button
          onClick={onRunChecks}
          disabled={checking}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition-colors disabled:cursor-default disabled:opacity-60"
          style={
            allPassed
              ? { background: 'rgba(34,197,94,0.16)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.45)' }
              : { background: 'linear-gradient(135deg, var(--accent), var(--accent-light))', color: '#ffffff', border: '1px solid transparent', boxShadow: '0 4px 16px rgba(0,91,197,0.35)' }
          }
        >
          {checking ? (
            <Loader2 size={15} className="animate-spin" />
          ) : allPassed ? (
            <Check size={15} strokeWidth={3} />
          ) : null}
          {checking ? 'Checking your code…' : allPassed ? 'You did it!' : 'Check your code'}
        </button>
      </div>
    </div>
  );
}

export const LabDescriptionPane = memo(LabDescriptionPaneInner);
