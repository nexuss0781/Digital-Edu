import { memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ChevronDown, Loader, Lock } from 'lucide-react';
import { CurriculumNode } from '@/types';

const TYPE_BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  lecture: { bg: 'var(--accent-glow-strong)', color: 'var(--accent)' },
  quiz: { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B' },
  test: { bg: 'rgba(0,20,73,0.15)', color: '#001449' },
  exam: { bg: 'rgba(0,180,252,0.12)', color: '#00B4FC' },
  workshop: { bg: 'rgba(23,249,255,0.12)', color: '#17F9FF' },
  practical: { bg: 'var(--accent-glow)', color: 'var(--accent-light)' },
  project: { bg: 'rgba(1,38,119,0.12)', color: '#012677' },
};

function StatusIcon({ node }: { node: CurriculumNode }) {
  if (node.completed) {
    return <CheckCircle2 size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />;
  }
  if (node.locked) {
    return <Lock size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />;
  }
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

function StepGrid({ node }: { node: CurriculumNode }) {
  const navigate = useNavigate();
  const stepCount = node.step_count || 0;
  if (stepCount === 0) return null;

  const isDone = (n: number) => node.completed || (typeof node.step_index === 'number' && n < node.step_index);
  const isCurrent = (n: number) => !node.completed && node.step_index === n;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))',
        gap: 8,
        padding: '4px 12px 10px 33px',
      }}
    >
      {Array.from({ length: stepCount }, (_, i) => i + 1).map((n) => {
        const done = isDone(n);
        const current = isCurrent(n);
        const clickable = done || current;
        return (
          <button
            key={n}
            onClick={(e) => {
              e.stopPropagation();
              if (clickable && node.id) navigate(`/content/${node.id}?step=${n}`);
            }}
            title={clickable ? `Jump to step ${n}` : `Step ${n} (locked)`}
            style={{
              aspectRatio: '1 / 1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 8,
              border: '1px solid',
              cursor: clickable ? 'pointer' : 'default',
              transition: 'all 0.15s',
              background: done
                ? 'var(--success-glow)'
                : current
                  ? 'rgba(245,158,11,0.12)'
                  : 'var(--bg-elevated)',
              borderColor: done
                ? 'var(--success)'
                : current
                  ? 'rgba(245,158,11,0.4)'
                  : 'var(--border)',
              color: done ? 'var(--success)' : current ? 'var(--color-gold)' : 'var(--text-muted)',
            }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

export function LessonRowBase({ node, courseId }: { node: CurriculumNode; courseId: string }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const locked = node.locked;
  const completed = node.completed;
  const typeStyle = node.content_type ? TYPE_BADGE_COLORS[node.content_type] || TYPE_BADGE_COLORS.lecture : null;
  const isWorkshop = node.content_type === 'workshop';

  const handleClick = () => {
    if (!locked && node.id) {
      navigate(`/content/${node.id}`);
    }
  };

  return (
    <div>
      <div
        onClick={handleClick}
        role={!locked ? 'button' : undefined}
        tabIndex={!locked ? 0 : undefined}
        onKeyDown={(e) => {
          if (!locked && e.key === 'Enter') handleClick();
        }}
        className={!locked ? 'hover-bg-accent' : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '9px 12px',
          borderRadius: 8,
          border: 'none',
          borderLeft: '3px solid transparent',
          backgroundColor: 'transparent',
          cursor: locked ? 'not-allowed' : 'pointer',
          opacity: locked ? 0.4 : 1,
          transition: 'all 0.15s',
          textAlign: 'left',
          width: '100%',
        }}
      >
        <StatusIcon node={node} />

        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 400,
            color: completed ? 'var(--text-muted)' : 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textDecoration: completed ? 'none' : 'none',
          }}
        >
          {node.name}
        </span>

        {typeStyle && node.content_type && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              padding: '2px 8px',
              borderRadius: 6,
              backgroundColor: typeStyle.bg,
              color: typeStyle.color,
              whiteSpace: 'nowrap',
            }}
          >
            {node.content_type}
          </span>
        )}

        {isWorkshop && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            aria-label={expanded ? 'Collapse workshop steps' : 'Show workshop steps'}
            className="hover-text-secondary"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              cursor: locked ? 'not-allowed' : 'pointer',
              color: 'var(--text-muted)',
              opacity: expanded ? 0.9 : 0.55,
              transition: 'all 0.15s',
              flexShrink: 0,
            }}
          >
            <ChevronDown size={14} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>
        )}
      </div>

      {isWorkshop && expanded && <StepGrid node={node} />}
    </div>
  );
}

const LessonRow = memo(LessonRowBase);
export default LessonRow;
