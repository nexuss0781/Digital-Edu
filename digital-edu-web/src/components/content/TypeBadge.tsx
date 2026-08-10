
const TYPE_STYLES: Record<string, React.CSSProperties> = {
  lecture: { background: 'var(--accent)', color: '#fff' },
  pdf: { background: 'var(--danger)', color: '#fff' },
  quiz: { background: 'var(--color-gold)', color: '#000' },
  test: { background: 'var(--color-navy)', color: '#fff' },
  exam: { background: 'var(--color-blue-3)', color: '#000' },
  workshop: { background: 'var(--color-cyan)', color: '#000' },
  practical: { background: 'var(--accent)', color: '#fff' },
  project: { background: 'var(--color-navy-light)', color: '#fff' },
};

const DEFAULT_STYLE: React.CSSProperties = { background: 'var(--accent)', color: '#fff' };

export default function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest"
      style={TYPE_STYLES[type] || DEFAULT_STYLE}
    >
      {type}
    </span>
  );
}
