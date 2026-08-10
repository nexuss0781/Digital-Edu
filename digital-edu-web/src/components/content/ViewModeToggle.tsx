import { useState, useRef, useEffect } from 'react';
import { Maximize2, Minimize2, Columns, ChevronDown } from 'lucide-react';

type ViewMode = 'default' | 'maximize' | 'fullscreen';

interface Props {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const MODES: { key: ViewMode; label: string; icon: React.ReactNode }[] = [
  { key: 'default', label: 'Default', icon: <Columns size={16} /> },
  { key: 'maximize', label: 'Maximize', icon: <Maximize2 size={16} /> },
  { key: 'fullscreen', label: 'Fullscreen', icon: <Minimize2 size={16} /> },
];

export default function ViewModeToggle({ mode, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
        }}
      >
        {MODES.find((m) => m.key === mode)?.icon}
        <span className="hidden sm:inline">{MODES.find((m) => m.key === mode)?.label}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 min-w-[140px] overflow-hidden rounded-lg shadow-lg animate-slide-up"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            zIndex: 100,
          }}
        >
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => {
                onChange(m.key);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium transition-colors"
              style={{
                color: m.key === mode ? 'var(--accent)' : 'var(--text-secondary)',
                background: m.key === mode ? 'var(--accent-glow)' : 'transparent',
              }}
              onMouseEnter={(e) => {
                if (m.key !== mode) e.currentTarget.style.background = 'var(--accent-glow)';
              }}
              onMouseLeave={(e) => {
                if (m.key !== mode) e.currentTarget.style.background = 'transparent';
              }}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
