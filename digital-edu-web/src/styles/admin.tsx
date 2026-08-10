import { ReactNode, type MouseEvent as ReactMouseEvent } from 'react';

/* ─── Design Tokens ─────────────────────────────────── */

export const tokens = {
  sidebarWidth: 240,
  sidebarCollapsed: 64,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  radius: {
    sm: 6,
    md: 8,
    lg: 10,
    xl: 12,
  },
  font: {
    ui: "var(--font-sans)",
    mono: "var(--font-mono)",
  },
  size: {
    xs: 11,
    sm: 12,
    base: 13,
    md: 14,
    lg: 16,
    xl: 20,
    '2xl': 24,
  },
} as const;

/* ─── Shared Style Objects ──────────────────────────── */

export const page: React.CSSProperties = {
  animation: 'fade-in 0.35s ease',
};

export const pageHeader: React.CSSProperties = {
  marginBottom: 28,
};

export const pageTitle: React.CSSProperties = {
  fontSize: tokens.size['2xl'],
  fontWeight: 700,
  color: 'var(--text)',
  letterSpacing: '-0.02em',
  lineHeight: 1.25,
};

export const pageSubtitle: React.CSSProperties = {
  fontSize: tokens.size.base,
  color: 'var(--text-muted)',
  marginTop: 4,
};

export const sectionCard: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: tokens.xl,
  padding: 20,
};

export const sectionTitle: React.CSSProperties = {
  fontSize: tokens.size.lg,
  fontWeight: 600,
  color: 'var(--text)',
  marginBottom: 16,
  letterSpacing: '-0.01em',
};

export const sectionLabel: React.CSSProperties = {
  fontSize: tokens.size.xs,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  marginBottom: 8,
};

/* ─── Form Elements ──────────────────────────────────── */

export const inputBase: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: tokens.md,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: tokens.size.base,
  fontFamily: tokens.font.ui,
  boxSizing: 'border-box',
  outline: 'none',
  transition: 'border-color 0.15s, box-shadow 0.15s',
};

export const inputFocus: React.CSSProperties = {
  borderColor: 'var(--accent)',
  boxShadow: '0 0 0 3px var(--accent-glow)',
};

export const inputStyle: React.CSSProperties = { ...inputBase };

export const selectStyle: React.CSSProperties = {
  ...inputBase,
  cursor: 'pointer',
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
  paddingRight: 32,
};

export const textareaStyle: React.CSSProperties = {
  ...inputBase,
  resize: 'vertical',
  fontFamily: tokens.font.mono,
  lineHeight: 1.6,
};

/* ─── Buttons ────────────────────────────────────────── */

export function primaryBtn(custom?: React.CSSProperties): React.CSSProperties {
  return {
    padding: '9px 18px',
    borderRadius: tokens.md,
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    fontSize: tokens.size.base,
    fontWeight: 600,
    fontFamily: tokens.font.ui,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    transition: 'opacity 0.15s, transform 0.1s',
    ...custom,
  };
}

export function secondaryBtn(custom?: React.CSSProperties): React.CSSProperties {
  return {
    padding: '9px 18px',
    borderRadius: tokens.md,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: tokens.size.base,
    fontWeight: 600,
    fontFamily: tokens.font.ui,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    transition: 'background 0.15s, border-color 0.15s',
    ...custom,
  };
}

export function ghostBtn(custom?: React.CSSProperties): React.CSSProperties {
  return {
    padding: '6px 10px',
    borderRadius: tokens.sm,
    border: 'none',
    background: 'transparent',
    color: 'var(--text-muted)',
    fontSize: tokens.size.xs,
    fontWeight: 500,
    fontFamily: tokens.font.ui,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    transition: 'background 0.12s, color 0.12s',
    ...custom,
  };
}

export function successBtn(custom?: React.CSSProperties): React.CSSProperties {
  return {
    ...primaryBtn(),
    background: 'var(--success)',
    ...custom,
  };
}

export function dangerBtn(custom?: React.CSSProperties): React.CSSProperties {
  return {
    ...secondaryBtn(),
    color: 'var(--danger)',
    ...custom,
  };
}

/* ─── Tags & Badges ──────────────────────────────────── */

export function tag(variant?: 'default' | 'success' | 'warning' | 'danger' | 'info'): React.CSSProperties {
  const base = {
    fontSize: tokens.size.xs,
    padding: '2px 8px',
    borderRadius: 4,
    fontWeight: 600,
    textTransform: 'capitalize' as const,
    whiteSpace: 'nowrap' as const,
  };
  switch (variant) {
    case 'success': return { ...base, background: 'var(--success-glow)', color: 'var(--success)' };
    case 'warning': return { ...base, background: 'rgba(245,158,11,0.12)', color: '#D97706' };
    case 'danger': return { ...base, background: 'rgba(220,38,38,0.1)', color: 'var(--danger)' };
    case 'info': return { ...base, background: 'var(--accent-glow)', color: 'var(--accent-light)' };
    default: return { ...base, background: 'var(--bg-elevated)', color: 'var(--text-muted)' };
  }
}

export const lockTag: Record<string, React.CSSProperties> = {
  pass: { ...tag('info'), textTransform: 'uppercase' as const },
  date: { ...tag('warning'), textTransform: 'uppercase' as const },
  manual: { ...tag('danger'), textTransform: 'uppercase' as const },
};

/* ─── Tables ─────────────────────────────────────────── */

export const tableHead: React.CSSProperties = {
  textAlign: 'left',
  padding: '11px 14px',
  fontSize: tokens.size.xs,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-muted)',
  background: 'var(--bg)',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border)',
};

export const tableCell: React.CSSProperties = {
  padding: '11px 14px',
  fontSize: tokens.size.base,
  color: 'var(--text)',
  borderTop: '1px solid var(--border)',
  lineHeight: 1.4,
};

export const tableRowHover = (isSelected?: boolean): React.CSSProperties => ({
  cursor: 'pointer',
  transition: 'background 0.1s',
  background: isSelected ? 'var(--accent-glow)' : undefined,
});

/* ─── Utility classes as components ──────────────────── */

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={pageHeader}>
      <h1 style={pageTitle}>{title}</h1>
      {subtitle && <p style={pageSubtitle}>{subtitle}</p>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label style={{
        fontSize: tokens.size.sm,
        fontWeight: 500,
        color: 'var(--text-secondary)',
        display: 'block',
        marginBottom: 5,
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function Tag({ children, variant }: { children: ReactNode; variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' }) {
  return <span style={tag(variant)}>{children}</span>;
}

export function IconBtn({ children, onClick, title, style }: {
  children: ReactNode;
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  title?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '5px 10px',
        borderRadius: tokens.sm,
        fontSize: tokens.size.xs,
        fontWeight: 600,
        fontFamily: tokens.font.ui,
        border: '1px solid var(--border)',
        background: 'transparent',
        color: 'var(--text-muted)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        transition: 'all 0.12s',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Badge({ children, variant }: {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const colors: Record<string, { bg: string; color: string }> = {
    default: { bg: 'var(--bg-elevated)', color: 'var(--text-muted)' },
    success: { bg: 'rgba(22,163,74,0.1)', color: 'var(--success)' },
    warning: { bg: 'rgba(245,158,11,0.1)', color: '#D97706' },
    danger: { bg: 'rgba(220,38,38,0.1)', color: 'var(--danger)' },
    info: { bg: 'var(--accent-glow)', color: 'var(--accent)' },
  };
  const c = colors[variant || 'default'];
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 9px',
      borderRadius: 9999,
      fontSize: tokens.size.xs,
      fontWeight: 600,
      background: c.bg,
      color: c.color,
    }}>
      {children}
    </span>
  );
}

/* ─── Empty / Loading States ─────────────────────────── */

export function EmptyState({ icon, message }: { icon: ReactNode; message: string }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '48px 24px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: tokens.xl,
    }}>
      <div style={{ color: 'var(--text-muted)', opacity: 0.4, marginBottom: 12 }}>
        {icon}
      </div>
      <p style={{ fontSize: tokens.size.base, color: 'var(--text-muted)' }}>{message}</p>
    </div>
  );
}

export function LoadingState({ text = 'Loading...' }: { text?: string }) {
  return (
    <div style={{
      textAlign: 'center',
      padding: 40,
      color: 'var(--text-muted)',
      fontSize: tokens.size.base,
    }}>
      {text}
    </div>
  );
}
