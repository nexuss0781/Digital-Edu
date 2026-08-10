import { CurriculumNode } from '@/types';
import ModuleRow from './ModuleRow';
import LessonRow from './LessonRow';

interface CurriculumAccordionProps {
  nodes: CurriculumNode[];
  courseId: string;
}

export default function CurriculumAccordion({ nodes, courseId }: CurriculumAccordionProps) {
  if (!nodes || nodes.length === 0) {
    return (
      <div
        style={{
          padding: 48,
          textAlign: 'center',
          color: 'var(--text-muted)',
        }}
      >
        <p style={{ fontSize: 14 }}>No curriculum available</p>
      </div>
    );
  }

  return (
    <div
      className="animate-fade-in"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {nodes.map((node) => {
        if (node.type === 'category') {
          return <ModuleRow key={node.id} node={node} courseId={courseId} />;
        }
        return <LessonRow key={node.id} node={node} courseId={courseId} />;
      })}
    </div>
  );
}
