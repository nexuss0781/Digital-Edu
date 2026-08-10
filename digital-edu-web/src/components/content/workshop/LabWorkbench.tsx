import { useCallback, useEffect, useRef, useState } from 'react';
import { useLab } from '@/hooks/useLab';
import { codeForTests } from '@/lib/workshopParser';
import { buildLabSrcDoc } from '@/lib/labParser';
import { runStepChecks } from '@/lib/workshopChecks';
import type { ContentDetail } from '@/types';
import BreadcrumbBar from '../BreadcrumbBar';
import { LabDescriptionPane } from './LabDescriptionPane';
import { LabEditorPane } from './LabEditorPane';
import { LabRightPane } from './LabRightPane';

interface Props {
  content: ContentDetail;
  onTreeToggle: () => void;
  onComplete?: () => void;
}

export default function LabWorkbench({ content, onTreeToggle, onComplete }: Props) {
  const state = useLab(content, onComplete);
  const [checking, setChecking] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const assetBase = content.lab?.asset_base;
  const rewrites = content.lab?.rewrites;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        state.saveNow();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.saveNow]);

  const runChecks = useCallback(async () => {
    if (checking) return;
    const hints = state.hints;
    if (hints.length === 0) return;

    const ws = state.workspace;
    const code = codeForTests(ws);
    const src = buildLabSrcDoc(ws, assetBase, rewrites);
    window.postMessage({ source: 'digitaledu-console', level: 'hint-clear' }, '*');
    setChecking(true);

    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
    frameRef.current = frame;

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      frame.onload = null;
      frameRef.current = null;
      setChecking(false);
      if (frame.parentNode) frame.parentNode.removeChild(frame);
    };

    const safety = window.setTimeout(settle, 20000);

    frame.onload = async () => {
      window.clearTimeout(safety);
      const win = frame.contentWindow;
      try {
        for (const hint of hints) {
          const single = win
            ? runStepChecks([{ text: hint.text, code: hint.testCode }], code, win)
            : [];
          const res = single[0] || { text: hint.text, passed: false };
          state.applyHintResult(hint.id, res.passed);
          window.postMessage(
            { source: 'digitaledu-console', level: res.passed ? 'hint-pass' : 'hint', text: res.text },
            '*'
          );
          await new Promise((r) => setTimeout(r, 350));
        }
      } catch {
        // Ignore per-hint failures; states stay unchecked
      } finally {
        settle();
      }
    };

    frame.srcdoc = src;
    document.body.appendChild(frame);
  }, [state, checking, assetBase, rewrites]);

  if (state.loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 56px)' }}>
        <div className="text-center">
          <div
            className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2"
            style={{ borderColor: 'var(--border)', borderTopColor: 'var(--color-gold)' }}
          />
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Loading lab…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>
      <div
        className="shrink-0 border-b px-3 py-2 sm:px-4"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <BreadcrumbBar breadcrumbs={content.breadcrumb || []} onTreeToggle={onTreeToggle} />
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="hidden text-sm font-bold md:block" style={{ color: 'var(--text)' }}>
              {content.title || content.name}
            </span>
          </div>
        </div>
      </div>

      <div className="relative grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <div
          className="hidden min-h-0 overflow-hidden lg:block"
          style={{ borderRight: '1px solid var(--border)' }}
        >
          <LabDescriptionPane
            state={state}
            description={content.lab?.description || ''}
            assets={content.lab?.assets || []}
            onRunChecks={runChecks}
            checking={checking}
          />
        </div>

        <div className="min-h-0 overflow-hidden">
          <LabEditorPane state={state} />
        </div>

        <div
          className="hidden min-h-0 overflow-hidden border-l xl:block"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
        >
          <LabRightPane workspace={state.workspace} assetBase={assetBase} rewrites={rewrites} />
        </div>
      </div>
    </div>
  );
}
