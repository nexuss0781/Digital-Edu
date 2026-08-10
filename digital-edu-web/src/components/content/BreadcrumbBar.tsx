import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Home, ChevronRight, List } from 'lucide-react';
import { BreadcrumbItem } from '@/types';

interface Props {
  breadcrumbs: BreadcrumbItem[];
  onTreeToggle: () => void;
  siblings?: BreadcrumbItem[];
}

export default function BreadcrumbBar({ breadcrumbs, onTreeToggle, siblings }: Props) {
  return (
    <div
      className="flex items-center gap-1 overflow-x-auto rounded-xl px-3 py-2"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <Link
        to="/courses"
        className="flex shrink-0 items-center justify-center rounded-lg p-1.5 transition-colors hover:opacity-80"
        style={{ color: 'var(--text-muted)' }}
      >
        <Home size={16} />
      </Link>

      {breadcrumbs.map((item, i) => (
        <span key={item.id} className="flex items-center gap-1">
          <ChevronRight size={12} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
          {i === breadcrumbs.length - 1 ? (
            <span className="shrink-0 truncate text-xs font-bold" style={{ color: 'var(--accent)' }}>
              {item.name}
            </span>
          ) : (
            <BreadcrumbDropdown item={item} siblings={siblings} />
          )}
        </span>
      ))}

      <div className="ml-auto shrink-0">
        <button
          onClick={onTreeToggle}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
          style={{
            color: 'var(--text-secondary)',
            background: 'var(--bg-elevated)',
          }}
          title="Toggle course navigator"
        >
          <List size={14} />
          <span className="hidden sm:inline">Navigator</span>
        </button>
      </div>
    </div>
  );
}

function BreadcrumbDropdown({ item, siblings }: { item: BreadcrumbItem; siblings?: BreadcrumbItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="max-w-[120px] truncate rounded-md px-1.5 py-0.5 text-xs transition-colors hover:opacity-80"
        style={{ color: 'var(--text-secondary)' }}
      >
        {item.name}
      </button>
      {open && siblings && siblings.length > 0 && (
        <div
          className="absolute left-0 top-full z-50 mt-1 max-h-[200px] min-w-[160px] overflow-y-auto rounded-lg shadow-lg animate-slide-up"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
          }}
        >
          {siblings.map((sib) => (
            <Link
              key={sib.id}
              to={`/content/${sib.id}`}
              className="block truncate px-3 py-1.5 text-xs transition-colors"
              style={{
                color: sib.id === item.id ? 'var(--accent)' : 'var(--text-secondary)',
                background: sib.id === item.id ? 'var(--accent-glow)' : 'transparent',
              }}
              onClick={() => setOpen(false)}
              onMouseEnter={(e) => { if (sib.id !== item.id) e.currentTarget.style.background = 'var(--accent-glow)'; }}
              onMouseLeave={(e) => { if (sib.id !== item.id) e.currentTarget.style.background = 'transparent'; }}
            >
              {sib.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
