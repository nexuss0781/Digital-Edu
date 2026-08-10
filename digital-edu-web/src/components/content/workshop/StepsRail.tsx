import { memo } from 'react';
import { Check, Lock, X } from 'lucide-react';
import type { WorkshopState } from '@/hooks/useWorkshop';
import type { ParsedStep } from '@/lib/workshopParser';

interface Props {
  state: WorkshopState;
  parsedSteps: ParsedStep[];
  onClose?: () => void;
}

function StepsRailInner({ state, parsedSteps, onClose }: Props) {
  return (
    <div className="flex h-full flex-col" style={{ userSelect: 'none' }}>
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          Steps
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {state.completedCount}/{state.totalSteps}
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-md p-1 transition-colors hover:bg-[var(--accent-glow)]"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Close steps panel"
            >
              <X size={14} />
            </button>
          )}
        </span>
      </div>

      <div className="relative flex-1 overflow-y-auto px-3 py-3">
        <ol className="relative">
          {parsedSteps.map((step, idx) => {
            const isCurrent = idx === state.currentIndex;
            const isDone = state.completedSteps.has(idx);
            const isLocked = !state.isStepUnlocked(idx);
            return (
              <li key={step.step} className="relative pb-1">
                {idx < parsedSteps.length - 1 && (
                  <span
                    className="absolute left-[15px] top-7 h-[calc(100%-16px)] w-px"
                    style={{ background: isDone && !isCurrent ? 'var(--color-gold)' : 'var(--border)' }}
                    aria-hidden="true"
                  />
                )}
                <button
                  onClick={() => state.goTo(idx)}
                  disabled={isLocked}
                  className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--accent-glow)] disabled:cursor-default"
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  <span
                    className="relative z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-all duration-300"
                    style={{
                      background: isDone || isCurrent ? 'var(--color-gold)' : 'var(--bg-card)',
                      borderColor: isDone || isCurrent ? 'var(--color-gold)' : isLocked ? 'var(--border)' : 'var(--border)',
                      color: isDone || isCurrent ? '#001449' : isLocked ? 'var(--text-muted)' : 'var(--text-secondary)',
                      boxShadow: isCurrent ? '0 0 0 4px rgba(245,158,11,0.15)' : 'none',
                    }}
                  >
                    {isDone ? <Check size={14} strokeWidth={3} /> : isLocked ? <Lock size={13} /> : step.step}
                  </span>
                  <span className="min-w-0">
                    <span
                      className="block truncate text-sm"
                      style={{
                        color: isCurrent ? 'var(--text)' : isLocked ? 'var(--text-secondary)' : 'var(--text-secondary)',
                        fontWeight: isCurrent ? 600 : 500,
                      }}
                    >
                      {step.title || `Step ${step.step}`}
                    </span>
                    <span className="block truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                      {isLocked
                        ? 'Locked'
                        : step.targetFile === 'css'
                          ? 'styles.css'
                          : step.targetFile === 'js'
                            ? 'script.js'
                            : 'index.html'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

export const StepsRail = memo(StepsRailInner);
