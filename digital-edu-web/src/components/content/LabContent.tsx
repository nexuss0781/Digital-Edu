import type { ContentDetail } from '@/types';
import LabWorkbench from './workshop/LabWorkbench';

interface Props {
  content: ContentDetail;
  onTreeToggle?: () => void;
  onComplete?: () => void;
}

export default function LabContent({ content, onTreeToggle, onComplete }: Props) {
  return <LabWorkbench content={content} onTreeToggle={onTreeToggle || (() => {})} onComplete={onComplete} />;
}
