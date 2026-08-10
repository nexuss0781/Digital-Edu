import type { ContentDetail } from '@/types';
import WorkshopWorkbench from './workshop/WorkshopWorkbench';

interface Props {
  content: ContentDetail;
  onTreeToggle?: () => void;
  onComplete?: () => void;
}

export default function WorkshopContent({ content, onTreeToggle, onComplete }: Props) {
  return <WorkshopWorkbench content={content} onTreeToggle={onTreeToggle || (() => {})} onComplete={onComplete} />;
}
