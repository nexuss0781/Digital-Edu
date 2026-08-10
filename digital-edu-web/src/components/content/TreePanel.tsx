import { memo, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, ChevronRight, BookOpen, FileText, File, Trophy, Code, FolderOpen } from 'lucide-react';
import { CurriculumNode } from '@/types';
import { getCurriculum } from '@/lib/curriculumCache';
import TypeBadge from './TypeBadge';

interface Props {
  open: boolean;
  onClose: () => void;
  currentContentId: string;
  courseId?: string;
}

function getNodeIcon(node: CurriculumNode) {
  const type = node.content_type || node.type;
  switch (type) {
    case 'lecture': case 'review': return <FileText size={14} />;
    case 'quiz': case 'test': case 'exam': return <Trophy size={14} />;
    case 'workshop': case 'practical': return <Code size={14} />;
    case 'pdf': return <File size={14} />;
    case 'category': return <FolderOpen size={14} />;
    default: return <BookOpen size={14} />;
  }
}

function collectPath(node: CurriculumNode, target: string, acc: Set<string>): boolean {
  if (node.id === target) {
    acc.add(node.id);
    return true;
  }
  if (node.children) {
    for (const child of node.children) {
      if (collectPath(child, target, acc)) {
        acc.add(node.id);
        return true;
      }
    }
  }
  return false;
}

const TreeNode = memo(function TreeNode({
  node,
  currentContentId,
  expandedPath,
  depth = 0,
}: {
  node: CurriculumNode;
  currentContentId: string;
  expandedPath: Set<string>;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(() => depth < 1 || expandedPath.has(node.id));
  const isCurrent = node.id === currentContentId;
  const hasChildren = node.children && node.children.length > 0;
  const isLeaf = !hasChildren && node.content_type !== 'category';

  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors"
        style={{
          paddingLeft: `${depth * 16 + 8}px`,
          background: isCurrent ? 'var(--accent-glow-strong)' : 'transparent',
          color: isCurrent ? 'var(--accent)' : 'var(--text-secondary)',
          fontWeight: isCurrent ? 600 : 400,
        }}
      >
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 rounded p-0.5 transition-transform"
            style={{ color: 'var(--text-muted)' }}
          >
            <ChevronRight
              size={12}
              className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          </button>
        ) : (
          <span className="shrink-0 w-5" />
        )}

        <span className="shrink-0" style={{ color: isCurrent ? 'var(--accent)' : 'var(--text-muted)' }}>
          {getNodeIcon(node)}
        </span>

        {isLeaf ? (
          <Link
            to={`/content/${node.id}`}
            className="flex-1 truncate hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {node.name}
          </Link>
        ) : (
          <span className="flex-1 truncate">{node.name}</span>
        )}

        {node.content_type && (
          <span className="shrink-0">
            <TypeBadge type={node.content_type} />
          </span>
        )}
      </div>

      {hasChildren && expanded && (
        <div className="overflow-hidden">
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              currentContentId={currentContentId}
              expandedPath={expandedPath}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default function TreePanel({ open, onClose, currentContentId, courseId }: Props) {
  const [tree, setTree] = useState<CurriculumNode | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (open && courseId) {
      setLoading(true);
      getCurriculum(courseId)
        .then((data) => {
          if (!cancelled) setTree(data as unknown as CurriculumNode);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [open, courseId]);

  const expandedPath = useMemo(() => {
    const acc = new Set<string>();
    if (tree) collectPath(tree, currentContentId, acc);
    return acc;
  }, [tree, currentContentId]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[9998] transition-opacity"
          style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
          onClick={onClose}
        />
      )}

      <div
        className="fixed top-0 left-0 z-[9999] h-full overflow-y-auto transition-transform duration-300 ease-out"
        style={{
          width: '380px',
          maxWidth: '85vw',
          background: 'var(--bg)',
          borderRight: '1px solid var(--border)',
          boxShadow: open ? 'var(--shadow-lg)' : 'none',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
        }}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-4 py-3"
          style={{
            background: 'var(--bg)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div>
            <h3
              className="text-sm font-bold"
              style={{ color: 'var(--text)', fontFamily: 'var(--font-display)' }}
            >
              Course Navigator
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-2">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
            </div>
          )}
          {!loading && tree && (
            <TreeNode node={tree} currentContentId={currentContentId} expandedPath={expandedPath} />
          )}
          {!loading && !tree && (
            <p className="py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              No course data available
            </p>
          )}
        </div>
      </div>
    </>
  );
}
