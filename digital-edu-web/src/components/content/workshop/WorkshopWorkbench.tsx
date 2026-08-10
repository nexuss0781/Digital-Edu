import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelLeft } from 'lucide-react';
import { useWorkshop } from '@/hooks/useWorkshop';
import { parseWorkshop, buildSrcDoc, codeForTests } from '@/lib/workshopParser';
import { runStepChecks } from '@/lib/workshopChecks';
import type { ContentDetail } from '@/types';
import BreadcrumbBar from '../BreadcrumbBar';
import { DescriptionPane } from './DescriptionPane';
import { EditorPane } from './EditorPane';
import { LiveViewer } from './LiveViewer';
import { StepsRail } from './StepsRail';

interface Props {
  content: ContentDetail;
  onTreeToggle: () => void;
  onComplete?: () => void;
}

export default function WorkshopWorkbench({ content, onTreeToggle, onComplete }: Props) {
  const state = useWorkshop(content, onComplete);
  const [railOpen, setRailOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

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

  const model = useMemo(
    () =>
      parseWorkshop({
        id: content.id,
        steps:
          content.assessments?.[0]?.steps?.map((s) => ({
            step: s.step,
            title: s.title,
            description: s.description,
          })) || [],
      }),
    [content]
  );

  const runChecks = useCallback(() => {
    const step = state.currentStep;
    if (!step || !step.hints || step.hints.length === 0) return;
    if (checking) return;

    const ws = state.workspace;
    const code = codeForTests(ws);
    const src = buildSrcDoc(ws);
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

    const safety = window.setTimeout(settle, 8000);

    frame.onload = () => {
      window.clearTimeout(safety);
      try {
        const win = frame.contentWindow;
        const results = win ? runStepChecks(step.hints || [], code, win) : [];
        state.applyCheckResults(results);
      } catch {
        state.applyCheckResults([]);
      } finally {
        settle();
      }
    };

    frame.srcdoc = src;
    document.body.appendChild(frame);
  }, [state, checking]);

  if (state.loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 56px)' }}>
        <div className="text-center">
          <div
            className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2"
            style={{ borderColor: 'var(--border)', borderTopColor: 'var(--color-gold)' }}
          />
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Loading workshop…
          </p>
        </div>
      </div>
    );
  }

  const currentParsed = model.steps[state.currentIndex] || null;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>
      {/* Header strip */}
      <div className="shrink-0 border-b px-3 py-2 sm:px-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <BreadcrumbBar breadcrumbs={content.breadcrumb || []} onTreeToggle={onTreeToggle} />
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="hidden text-sm font-bold md:block" style={{ color: 'var(--text)' }}>
              {content.title || content.name}
            </span>
            <span
              className="rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums"
              style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--color-gold)', border: '1px solid rgba(245,158,11,0.35)' }}
            >
              Step {state.currentIndex + 1}/{state.totalSteps}
            </span>
            <button
              onClick={() => setRailOpen(true)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--accent-glow)]"
              style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            >
              <PanelLeft size={14} />
              Steps
            </button>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--border)' }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${state.progressPct}%`, background: 'linear-gradient(90deg, var(--color-gold), #FBBF24)' }}
          />
        </div>
      </div>

      {/* 3-pane grid: description | editor | live preview */}
      <div className="relative grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <div
          className="hidden min-h-0 overflow-hidden lg:block"
          style={{ borderRight: '1px solid var(--border)' }}
        >
          <DescriptionPane state={state} step={currentParsed} rewrites={content.rewrites} description={content.body} />
        </div>

        <div className="min-h-0 overflow-hidden">
          <EditorPane state={state} step={currentParsed} onRunChecks={runChecks} checking={checking} />
        </div>

        <div
          className="hidden min-h-0 overflow-hidden border-l xl:block"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
        >
          <LiveViewer workspace={state.workspace} rewrites={content.rewrites} />
        </div>
      </div>

      {/* Steps drawer */}
      {railOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRailOpen(false)} />
          <div
            className="absolute bottom-0 left-0 top-0 w-[300px] max-w-[85vw] animate-slide-up"
            style={{ background: 'var(--bg)', boxShadow: 'var(--shadow-lg)', borderRight: '1px solid var(--border)' }}
          >
            <StepsRail state={state} parsedSteps={model.steps} onClose={() => setRailOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
