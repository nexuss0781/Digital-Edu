import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, FileText, CheckCircle2, Activity,
  FolderTree, UserCheck, SquareCheck, ScrollText, Award,
} from 'lucide-react';
import { adminApi } from '@/lib/api';
import { AdminDashboardStats } from '@/types';
import { tokens, page, PageHeader, sectionCard } from '@/styles/admin';

const quickLinks = [
  {
    href: '/admin/content', label: 'Content Manager',
    desc: 'Organize, lock, hide, and edit content',
    icon: FolderTree,
  },
  {
    href: '/admin/users', label: 'Users',
    desc: 'Manage bans, mute, promote, restrict',
    icon: UserCheck,
  },
  {
    href: '/admin/submissions', label: 'Submissions',
    desc: 'Review and verdict project submissions',
    icon: SquareCheck,
  },
  {
    href: '/admin/certificates', label: 'Certificates',
    desc: 'Design templates and award certificates',
    icon: ScrollText,
  },
  {
    href: '/admin/badges', label: 'Badges',
    desc: 'Create and manage achievement badges',
    icon: Award,
  },
];

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.dashboard()
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const metrics = stats ? [
    {
      label: 'Total Users', value: stats.total_users,
      icon: Users, color: 'var(--accent)',
      bg: 'var(--accent-glow-strong)',
    },
    {
      label: 'Content Items', value: stats.content_count,
      icon: FileText, color: '#6366F1',
      bg: 'rgba(99,102,241,0.1)',
    },
    {
      label: 'Completed', value: stats.completed,
      icon: CheckCircle2, color: 'var(--success)',
      bg: 'var(--success-glow)',
    },
    {
      label: 'Progress Entries', value: stats.total_progress,
      icon: Activity, color: '#D97706',
      bg: 'rgba(245,158,11,0.1)',
    },
  ] : [];

  return (
    <div style={page}>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your platform"
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 16,
        marginBottom: 36,
      }}>
        {loading
          ? [1, 2, 3, 4].map(i => (
              <div key={i} style={{
                ...sectionCard, padding: 24,
              }}>
                <div className="skeleton-shimmer" style={{ height: 12, width: 80, marginBottom: 16, borderRadius: 4 }} />
                <div className="skeleton-shimmer" style={{ height: 32, width: 60, marginBottom: 14, borderRadius: 4 }} />
                <div className="skeleton-shimmer" style={{ height: 10, width: 100, borderRadius: 4 }} />
              </div>
            ))
          : metrics.map(m => {
              const Icon = m.icon;
              return (
                <div
                  key={m.label}
                  style={{
                    ...sectionCard,
                    padding: '22px 24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <span style={{
                      fontSize: tokens.size.xs,
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      fontFamily: tokens.font.ui,
                    }}>
                      {m.label}
                    </span>
                    <div style={{
                      width: 34, height: 34, borderRadius: tokens.sm,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: m.bg,
                      color: m.color,
                    }}>
                      <Icon size={16} />
                    </div>
                  </div>
                  <div style={{
                    fontSize: 30,
                    fontWeight: 800,
                    color: 'var(--text)',
                    letterSpacing: '-0.03em',
                    lineHeight: 1,
                    fontFamily: tokens.font.ui,
                  }}>
                    {m.value}
                  </div>
                </div>
              );
            })}
      </div>

      <div>
        <h2 style={{
          fontSize: tokens.size.lg,
          fontWeight: 600,
          color: 'var(--text)',
          letterSpacing: '-0.01em',
          marginBottom: 16,
          fontFamily: tokens.font.ui,
        }}>
          Quick Actions
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 12,
        }}>
          {quickLinks.map(link => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                to={link.href}
                style={{
                  ...sectionCard,
                  padding: '18px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  textDecoration: 'none',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--accent)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: tokens.md,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  background: 'var(--accent-glow)',
                  color: 'var(--accent)',
                }}>
                  <Icon size={18} />
                </div>
                <div>
                  <div style={{
                    fontWeight: 600,
                    fontSize: tokens.size.base,
                    color: 'var(--text)',
                    fontFamily: tokens.font.ui,
                  }}>
                    {link.label}
                  </div>
                  <div style={{
                    fontSize: tokens.size.sm,
                    color: 'var(--text-muted)',
                    marginTop: 2,
                    fontFamily: tokens.font.ui,
                  }}>
                    {link.desc}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
