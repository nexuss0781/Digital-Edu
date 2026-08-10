import { memo } from 'react';
import { ChevronLeft, ChevronRight, Check, CloudUpload, CloudOff, Loader2, Sparkles, X } from 'lucide-react';
import type { WorkshopState } from '@/hooks/useWorkshop';
import type { ParsedStep } from '@/lib/workshopParser';
import WorkshopEditor from './WorkshopEditor';
import { FileTabLogo } from './FileTabLogo';

interface Props {
  state: WorkshopState;
  step: ParsedStep | null;
  onRunChecks: () => void;
  checking: boolean;
}

const FILE_TABS: { key: 'html' | 'css' | 'js'; label: string }[] = [
  { key: 'html', label: 'index.html' },
  { key: 'css', label: 'styles.css' },
  { key: 'js', label: 'script.js' },
];

function EditorPaneInner({ state, step, onRunChecks, checking }: Props) {
  const {
    currentIndex,
    totalSteps,
    workspace,
    activeFile,
    setActiveFile,
    updateWorkspace,
    completedSteps,
    goPrev,
    goNext,
    saving,
    saved,
    checkResults,
  } = state;

  const isLast = currentIndex >= totalSteps - 1;
  const isDone = step ? completedSteps.has(step.step - 1) : false;
  const hintCount = state.currentStep?.hints?.length || 0;
  const hasChecks = hintCount > 0;

  const resultsPassed = checkResults !== null && checkResults.length > 0 && checkResults.every((r) => r.passed);

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg-card)' }}>
      <div className="flex items-center gap-1 border-b px-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-hover)' }}>
        {FILE_TABS.map((tab) => {
          const isActive = tab.key === activeFile;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveFile(tab.key)}
              className="flex items-center gap-1.5 rounded-t-md px-3 py-2 text-xs font-medium transition-colors"
              style={{
                background: isActive ? 'var(--bg)' : 'transparent',
                color: isActive ? 'var(--text)' : 'var(--text-secondary)',
                borderTop: isActive ? '2px solid var(--color-gold)' : '2px solid transparent',
              }}
            >
              <FileTabLogo name={tab.key} size={13} />
              {tab.label}
            </button>
          );
        })}
        <div className="ml-auto flex items-center pr-2" style={{ color: saved ? 'var(--accent)' : 'var(--color-gold)' }}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <CloudUpload size={13} /> : <CloudOff size={13} />}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <WorkshopEditor
          activeFile={activeFile}
          value={workspace[activeFile]}
          onChange={(v) => updateWorkspace(activeFile, v)}
        />
      </div>

      {checkResults && checkResults.length > 0 && (
        <div
          className="shrink-0 border-t"
          style={{
            borderColor: resultsPassed ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
            background: resultsPassed ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.06)',
          }}
        >
          <div
            className="flex items-center gap-2 px-4 pt-2.5 text-sm font-semibold"
            style={{ color: resultsPassed ? '#22c55e' : '#ef4444' }}
          >
            {resultsPassed ? <Check size={16} /> : <X size={16} />}
            {resultsPassed ? 'Great work!' : 'Not quite yet'}
          </div>
          <div className="max-h-32 overflow-y-auto px-4 pb-2.5 pt-1">
            {resultsPassed ? (
              <div className="flex flex-wrap items-center justify-between gap-2 py-1">
                <span className="text-xs" style={{ color: '#22c55e' }}>
                  <Check size={14} className="mr-1 inline" />
                  Great work, this step is complete!
                </span>
                {!isLast && (
                  <button
                    onClick={goNext}
                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                    style={{ background: 'var(--success-glow)', color: 'var(--success)', border: '1px solid rgba(34,197,94,0.4)' }}
                  >
                    Next step
                    <ChevronRight size={14} />
                  </button>
                )}
              </div>
            ) : (
              <ul className="space-y-1">
                {checkResults.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                    <span className="mt-0.5 shrink-0 font-bold" style={{ color: r.passed ? '#22c55e' : '#ef4444' }}>
                      {r.passed ? '✓' : '✗'}
                    </span>
                    <span style={{ color: r.passed ? 'var(--text-secondary)' : 'var(--text)' }}>{r.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5" style={{ borderColor: 'var(--border)', background: 'var(--bg-hover)' }}>
        <button
          onClick={goPrev}
          disabled={currentIndex === 0}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ChevronLeft size={16} />
          Prev
        </button>

        <div className="flex items-center gap-2">
          {hasChecks && (
            <button
              onClick={onRunChecks}
              disabled={checking}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-default disabled:opacity-60"
              style={{
                background: resultsPassed ? 'var(--success-glow)' : 'var(--accent-glow)',
                color: resultsPassed ? 'var(--success)' : 'var(--accent)',
                border: `1px solid ${resultsPassed ? 'rgba(34,197,94,0.4)' : 'var(--accent-light)'}`,
              }}
            >
              {checking ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {checking ? 'Checking your code…' : resultsPassed ? 'Completed' : 'Check your code'}
            </button>
          )}
        </div>

        <button
          onClick={goNext}
          disabled={isLast || !isDone}
          title={isDone ? '' : 'Pass the checks to unlock the next step'}
          className="flex items-center gap-1 rounded-lg px-4 py-1.5 text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ background: 'var(--color-gold)', color: '#001449' }}
        >
          {isLast ? 'Finished' : 'Next'}
          {!isLast && <ChevronRight size={16} />}
        </button>
      </div>
    </div>
  );
}

export const EditorPane = memo(EditorPaneInner);
