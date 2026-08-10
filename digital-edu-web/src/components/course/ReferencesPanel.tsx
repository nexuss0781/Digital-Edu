import { ExternalLink, FileText, FileType, Image, FolderOpen } from 'lucide-react';
import { Reference } from '@/types';

function getRefIcon(ext: string) {
  const e = ext.toLowerCase();
  if (e === 'pdf') return <FileText size={18} style={{ color: '#dc2626' }} />;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(e)) return <Image size={18} style={{ color: '#16a34a' }} />;
  if (['txt', 'md', 'rst'].includes(e)) return <FileType size={18} style={{ color: 'var(--accent)' }} />;
  return <FolderOpen size={18} style={{ color: 'var(--text-muted)' }} />;
}

function getExtBadgeStyle(ext: string): { bg: string; color: string } {
  const e = ext.toLowerCase();
  if (e === 'pdf') return { bg: 'rgba(220,38,38,0.1)', color: '#dc2626' };
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(e)) return { bg: 'rgba(22,163,74,0.1)', color: '#16a34a' };
  return { bg: 'var(--accent-glow)', color: 'var(--accent)' };
}

interface ReferencesPanelProps {
  references: Reference[];
}

export default function ReferencesPanel({ references }: ReferencesPanelProps) {
  if (!references || references.length === 0) {
    return (
      <div
        style={{
          padding: 48,
          textAlign: 'center',
          color: 'var(--text-muted)',
        }}
      >
        <FolderOpen size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
        <p style={{ fontSize: 14 }}>No reference files available</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {references.map((ref, i) => {
        const badge = getExtBadgeStyle(ref.ext);
        return (
          <a
            key={i}
            href={ref.url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '14px 16px',
              borderRadius: 12,
              border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-card)',
              textDecoration: 'none',
              transition: 'all 0.15s',
              animationDelay: `${i * 50}ms`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.backgroundColor = 'var(--accent-glow)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.backgroundColor = 'var(--bg-card)';
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                backgroundColor: 'var(--bg-elevated)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {getRefIcon(ref.ext)}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'var(--text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {ref.name}
              </div>
              {ref.type && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {ref.type}
                </div>
              )}
            </div>

            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                padding: '3px 10px',
                borderRadius: 6,
                backgroundColor: badge.bg,
                color: badge.color,
                flexShrink: 0,
              }}
            >
              {ref.ext}
            </span>

            <ExternalLink size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </a>
        );
      })}
    </div>
  );
}
