export function SkeletonCard() {
  return (
    <div
      style={{
        borderRadius: 12,
        border: '1px solid var(--border)',
        backgroundColor: 'var(--bg-card)',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div className="skeleton-shimmer" style={{ width: '100%', height: 160, borderRadius: 8 }} />
      <div className="skeleton-shimmer" style={{ width: '70%', height: 18 }} />
      <div className="skeleton-shimmer" style={{ width: '100%', height: 12 }} />
      <div className="skeleton-shimmer" style={{ width: '40%', height: 12 }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <div className="skeleton-shimmer" style={{ width: 60, height: 24, borderRadius: 6 }} />
        <div className="skeleton-shimmer" style={{ width: 80, height: 24, borderRadius: 6 }} />
      </div>
    </div>
  );
}

export function SkeletonHero() {
  return (
    <div
      style={{
        width: '100%',
        padding: '48px 32px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <div className="skeleton-shimmer" style={{ width: 280, height: 32 }} />
      <div className="skeleton-shimmer" style={{ width: 420, height: 16 }} />
      <div className="skeleton-shimmer" style={{ width: 360, height: 16 }} />
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <div className="skeleton-shimmer" style={{ width: 140, height: 40, borderRadius: 8 }} />
        <div className="skeleton-shimmer" style={{ width: 140, height: 40, borderRadius: 8 }} />
      </div>
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div
      style={{
        width: '100%',
        padding: '16px 20px',
        borderRadius: 10,
        border: '1px solid var(--border)',
        backgroundColor: 'var(--bg-card)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <div className="skeleton-shimmer" style={{ width: 28, height: 28, borderRadius: 6, flexShrink: 0 }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="skeleton-shimmer" style={{ width: '60%', height: 14 }} />
        <div className="skeleton-shimmer" style={{ width: '40%', height: 10 }} />
      </div>
      <div className="skeleton-shimmer" style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0 }} />
    </div>
  );
}
