import { memo, useState } from 'react';
import { ChevronRight, CheckCircle2, Circle, Loader } from 'lucide-react';
import { CurriculumNode } from '@/types';
import LessonRow from './LessonRow';

interface ModuleRowProps {
  node: CurriculumNode;
  courseId: string;
  depth?: number;
}

function getStatusDot(node: CurriculumNode) {
  if (node.completed) return <CheckCircle2 size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />;
  if (node.completed_count !== undefined && node.total !== undefined) {
    if (node.completed_count > 0 && node.completed_count < node.total) {
      return (
        <Loader
          size={14}
          style={{
            color: 'var(--accent)',
            flexShrink: 0,
            animation: 'status-pulse 2s infinite',
          }}
        />
      );
    }
  }
  return <Circle size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, opacity: 0.5 }} />;
}

function ModuleRowBase({ node, courseId, depth = 0 }: ModuleRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const isSubcategory = node.type === 'category' && depth > 0;

  const lessonCount = node.total ?? node.children?.length ?? 0;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className={expanded ? undefined : 'hover-bg-accent'}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          borderRadius: 10,
          border: 'none',
          borderLeft: `3px solid ${expanded ? 'var(--accent)' : 'transparent'}`,
          backgroundColor: expanded ? 'var(--accent-glow)' : 'transparent',
          cursor: 'pointer',
          transition: 'all 0.15s',
          textAlign: 'left',
        }}
      >
        {hasChildren && (
          <ChevronRight
            size={16}
            style={{
              color: 'var(--text-muted)',
              transition: 'transform 0.2s',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              flexShrink: 0,
            }}
          />
        )}
        {!hasChildren && <span style={{ width: 16 }} />}

        {getStatusDot(node)}

        <span
          style={{
            flex: 1,
            fontSize: depth === 0 ? 15 : 14,
            fontWeight: depth === 0 ? 600 : 500,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {node.name}
        </span>

        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {lessonCount} {lessonCount === 1 ? 'lesson' : 'lessons'}
        </span>

        {isSubcategory && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              padding: '2px 8px',
              borderRadius: 6,
              backgroundColor: 'var(--accent-glow-strong)',
              color: 'var(--accent)',
              whiteSpace: 'nowrap',
            }}
          >
            section
          </span>
        )}
      </button>

      {/* Children */}
      {expanded && hasChildren && (
        <div
          style={{
            paddingLeft: depth === 0 ? 20 : 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            marginTop: 2,
          }}
        >
          {node.children!.map((child) => {
            if (child.type === 'category') {
              return <ModuleRow key={child.id} node={child} courseId={courseId} depth={depth + 1} />;
            }
            return <LessonRow key={child.id} node={child} courseId={courseId} />;
          })}
        </div>
      )}
    </div>
  );
}

const ModuleRow = memo(ModuleRowBase);
export default ModuleRow;
