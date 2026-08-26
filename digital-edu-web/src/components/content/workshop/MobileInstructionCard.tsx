import { memo } from 'react';
import { ChevronDown, ChevronUp, FileText } from 'lucide-react';
import type { WorkshopState } from '@/hooks/useWorkshop';
import type { ParsedStep } from '@/lib/workshopParser';
import type { Rewrite } from '@/types';
import StepDescription from './StepDescription';
import InlineMarkdown from '../InlineMarkdown';

interface Props {
  state: WorkshopState;
  step: ParsedStep | null;
  rewrites?: Rewrite[];
  description?: string;
  expanded: boolean;
  onToggle: () => void;
}

function MobileInstructionCardInner({ state, step, rewrites, description, expanded, onToggle }: Props) {
  return (
    <div
      className="flex flex-col"
      style={{
        background: '#001449',
        borderBottom: '1px solid rgba(23,249,255,0.18)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
      }}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-3 py-2.5"
        style={{ background: 'rgba(0,20,73,0.6)', userSelect: 'none' }}
      >
        <FileText size={13} style={{ color: 'var(--color-gold)' }} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wider" style={{ color: '#E8F0FE' }}>
          {expanded ? step?.title || `Step ${state.currentIndex + 1}` : `Step ${state.currentIndex + 1} · Instructions`}
        </span>
        <span className="shrink-0 text-[11px] font-medium tabular-nums" style={{ color: 'var(--color-gold)' }}>
          {state.currentIndex + 1}/{state.totalSteps}
        </span>
        {expanded ? (
          <ChevronUp size={14} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
        ) : (
          <ChevronDown size={14} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
        )}
      </button>

      {expanded && (
        <div className="workshop-description max-h-[45vh] overflow-y-auto px-4 py-3">
          {description && (
            <div className="mb-4 border-b pb-4 text-sm leading-relaxed" style={{ color: '#CFE0F8', borderColor: 'rgba(23,249,255,0.12)' }}>
              <InlineMarkdown text={description} />
            </div>
          )}
          {step ? (
            <StepDescription step={step} rewrites={rewrites} />
          ) : (
            <p className="text-sm" style={{ color: '#94A3B8' }}>
              No description.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export const MobileInstructionCard = memo(MobileInstructionCardInner);
