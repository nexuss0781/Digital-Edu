import { memo, useEffect, useRef, useState } from 'react';
import { CircleAlert, Check, Info, Lightbulb, Monitor, RotateCw, Terminal, Trash2, ExternalLink, TriangleAlert } from 'lucide-react';
import type { Workspace } from '@/lib/workshopParser';
import { buildLabSrcDoc, type ConsoleEntry } from '@/lib/labParser';
import type { Rewrite } from '@/types';

interface Props {
  workspace: Workspace;
  assetBase?: string;
  rewrites?: Rewrite[];
}

function LevelIcon({ level }: { level: ConsoleEntry['level'] }) {
  if (level === 'hint-pass') {
    return (
      <span className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(34,197,94,0.2)' }}>
        <Check size={10} strokeWidth={3} style={{ color: '#4ade80' }} />
      </span>
    );
  }
  if (level === 'hint') {
    return (
      <span className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(245,158,11,0.2)' }}>
        <Lightbulb size={10} style={{ color: '#fbbf24' }} />
      </span>
    );
  }
  if (level === 'error') {
    return (
      <span className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(239,68,68,0.22)' }}>
        <CircleAlert size={11} style={{ color: '#f87171' }} />
      </span>
    );
  }
  if (level === 'warn') {
    return (
      <span className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(251,191,36,0.18)' }}>
        <TriangleAlert size={11} style={{ color: '#fbbf24' }} />
      </span>
    );
  }
  if (level === 'info') {
    return (
      <span className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(34,211,238,0.15)' }}>
        <Info size={11} style={{ color: '#22d3ee' }} />
      </span>
    );
  }
  return (
    <span className="w-[14px] shrink-0 text-center font-bold leading-none" style={{ color: '#9CDCFE' }}>
      &gt;
    </span>
  );
}

function LabRightPaneInner({ workspace, assetBase, rewrites }: Props) {
  const [tab, setTab] = useState<'preview' | 'console'>('preview');
  const [nonce, setNonce] = useState(0);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const consoleScrollRef = useRef<HTMLDivElement | null>(null);

  const srcDoc = buildLabSrcDoc(workspace, assetBase, rewrites);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const d = e.data;
      if (d && d.source === 'digitaledu-console') {
        if (d.level === 'hint-clear') {
          setEntries((prev) => prev.filter((e) => e.level !== 'hint'));
          return;
        }
        const level: ConsoleEntry['level'] =
          d.level === 'error' || d.level === 'warn' || d.level === 'info' || d.level === 'hint' || d.level === 'hint-pass' ? d.level : 'log';
        setEntries((prev) => [...prev.slice(-199), { level, text: String(d.text ?? ''), time: Date.now() }]);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    const el = consoleScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const openExternal = () => {
    const win = window.open();
    if (win) {
      win.document.open();
      win.document.write(srcDoc);
      win.document.close();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: '#001449' }}>
      <div
        className="flex shrink-0 items-center gap-1 border-b px-2"
        style={{ borderColor: 'rgba(23,249,255,0.18)', background: 'rgba(0,20,73,0.6)' }}
      >
        <button
          onClick={() => setTab('preview')}
          className="flex items-center gap-1.5 rounded-t-md px-3 py-2 text-xs font-medium transition-colors"
          style={{
            background: tab === 'preview' ? '#001449' : 'transparent',
            color: tab === 'preview' ? '#E8F0FE' : '#94A3B8',
            borderTop: tab === 'preview' ? '2px solid var(--color-gold)' : '2px solid transparent',
          }}
        >
          <Monitor size={13} style={{ color: 'var(--color-cyan)' }} />
          Live preview
        </button>
        <button
          onClick={() => setTab('console')}
          className="flex items-center gap-1.5 rounded-t-md px-3 py-2 text-xs font-medium transition-colors"
          style={{
            background: tab === 'console' ? '#001449' : 'transparent',
            color: tab === 'console' ? '#E8F0FE' : '#94A3B8',
            borderTop: tab === 'console' ? '2px solid var(--color-gold)' : '2px solid transparent',
          }}
        >
          <Terminal size={13} style={{ color: entries.some((e) => e.level === 'error') ? '#f87171' : tab === 'console' ? 'var(--color-cyan)' : '#94A3B8' }} />
          Console
          {entries.length > 0 && (
            <span
              className="rounded-full px-1.5 text-[10px] font-bold tabular-nums"
              style={{ background: entries.some((e) => e.level === 'error') ? 'rgba(239,68,68,0.2)' : 'rgba(148,163,184,0.15)', color: entries.some((e) => e.level === 'error') ? '#f87171' : '#94A3B8' }}
            >
              {entries.length}
            </span>
          )}
        </button>
        <div className="ml-auto flex items-center gap-1 pr-1">
          {tab === 'preview' && (
            <>
              <button
                onClick={() => setNonce((n) => n + 1)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-[rgba(23,249,255,0.08)]"
                style={{ color: '#A5C8FF' }}
                title="Reload preview"
              >
                <RotateCw size={13} />
                Reload
              </button>
              <button
                onClick={openExternal}
                className="hidden items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-[rgba(23,249,255,0.08)] sm:flex"
                style={{ color: '#A5C8FF' }}
              >
                <ExternalLink size={13} />
                Open
              </button>
            </>
          )}
          {tab === 'console' && (
            <button
              onClick={() => setEntries([])}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-[rgba(23,249,255,0.08)]"
              style={{ color: '#A5C8FF' }}
            >
              <Trash2 size={13} />
              Clear
            </button>
          )}
        </div>
      </div>

      {tab === 'preview' ? (
        <div className="min-h-0 flex-1" style={{ background: '#ffffff' }}>
          <iframe
            key={nonce}
            srcDoc={srcDoc}
            title="Live preview"
            sandbox="allow-scripts allow-modals"
            className="h-full w-full border-0"
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col" style={{ background: '#001449' }}>
          <div ref={consoleScrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {entries.length === 0 ? (
              <div className="py-6 font-mono">
                <div className="flex items-center gap-2 text-[11px]" style={{ color: '#64748B' }}>
                  <span style={{ color: '#9CDCFE' }}>&gt;</span>
                  <span>Output from your page will appear here.</span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[11px]" style={{ color: '#64748B' }}>
                  <span style={{ color: '#9CDCFE' }}>&gt;</span>
                  <span>console.log(), console.warn() and errors are forwarded live.</span>
                </div>
              </div>
            ) : (
              <ul className="space-y-0.5 font-mono">
                {entries.map((entry, i) => (
                  <li key={i} className="flex items-start gap-2 rounded px-1 py-1 text-[11.5px] leading-relaxed" style={{ background: entry.level === 'error' ? 'rgba(239,68,68,0.08)' : entry.level === 'hint' ? 'rgba(245,158,11,0.07)' : entry.level === 'hint-pass' ? 'rgba(34,197,94,0.07)' : 'transparent' }}>
                    <span className="mt-[2px]">
                      <LevelIcon level={entry.level} />
                    </span>
                    <span className="break-all whitespace-pre-wrap" style={{ color: entry.level === 'error' ? '#fca5a5' : entry.level === 'hint' ? '#fcd34d' : entry.level === 'hint-pass' ? '#86efac' : entry.level === 'warn' ? '#fde68a' : '#E8F0FE' }}>
                      {entry.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const LabRightPane = memo(LabRightPaneInner);
