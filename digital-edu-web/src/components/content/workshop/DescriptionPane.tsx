import { memo } from 'react';
import { FileText } from 'lucide-react';
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
}

function DescriptionPaneInner({ state, step, rewrites, description }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: '#001449', userSelect: 'none' }}>
      <div className="flex items-center gap-1.5 border-b px-3 py-2" style={{ borderColor: 'rgba(23,249,255,0.18)', background: 'rgba(0,20,73,0.6)' }}>
        <FileText size={13} style={{ color: 'var(--color-gold)' }} />
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#E8F0FE' }}>
          {step?.title || `Step ${state.currentIndex + 1}`}
        </span>
        <span className="ml-auto text-[11px] font-medium tabular-nums" style={{ color: 'var(--color-gold)' }}>
          {state.currentIndex + 1}/{state.totalSteps}
        </span>
      </div>
      <div className="workshop-description min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {description && (
          <div className="mb-4 border-b pb-4 text-xs leading-relaxed" style={{ color: '#94A3B8', borderColor: 'rgba(23,249,255,0.12)' }}>
            <InlineMarkdown text={description} />
          </div>
        )}
        {step ? <StepDescription step={step} rewrites={rewrites} /> : <p className="text-sm" style={{ color: '#94A3B8' }}>No description.</p>}
      </div>
    </div>
  );
}

export const DescriptionPane = memo(DescriptionPaneInner);
