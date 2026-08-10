import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FileText, Users, SquareCheck, ScrollText, Award,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import { tokens } from '@/styles/admin';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/content', label: 'Content', icon: FileText },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/submissions', label: 'Submissions', icon: SquareCheck },
  { href: '/admin/certificates', label: 'Certificates', icon: ScrollText },
  { href: '/admin/badges', label: 'Badges', icon: Award },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (href: string) => pathname === href;

  return (
    <div style={{
      display: 'flex',
      minHeight: 'calc(100vh - 60px)',
    }}>
      <aside style={{
        width: collapsed ? tokens.sidebarCollapsed : tokens.sidebarWidth,
        flexShrink: 0,
        background: '#0F172A',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.25s ease',
        position: 'sticky',
        top: 0,
        height: 'calc(100vh - 60px)',
        zIndex: 30,
      }}>
        <div style={{
          padding: collapsed ? '20px 0' : '20px 20px 18px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          {collapsed ? (
            <img
              src="/images/logo.svg"
              alt="DigitalEdu"
              style={{
                width: 32,
                height: 32,
                display: 'block',
                margin: '0 auto',
              }}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img
                src="/images/logo.svg"
                alt="DigitalEdu"
                style={{
                  width: 36,
                  height: 36,
                  flexShrink: 0,
                }}
              />
              <div>
                <div style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: '#F1F5F9',
                  letterSpacing: '-0.02em',
                  fontFamily: tokens.font.ui,
                  lineHeight: 1.2,
                }}>
                  DigitalEdu
                </div>
                <div style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#64748B',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginTop: 1,
                  fontFamily: tokens.font.ui,
                }}>
                  Admin Console
                </div>
              </div>
            </div>
          )}
        </div>

        <nav style={{
          flex: 1,
          padding: collapsed ? '16px 8px' : '16px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}>
          {NAV_ITEMS.map(item => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                to={item.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: collapsed ? '11px 0' : '11px 14px',
                  borderRadius: tokens.md,
                  fontSize: tokens.size.base,
                  fontWeight: active ? 600 : 400,
                  color: active ? '#F1F5F9' : '#64748B',
                  background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                  textDecoration: 'none',
                  transition: 'all 0.15s',
                  justifyContent: collapsed ? 'center' : undefined,
                  position: 'relative',
                  fontFamily: tokens.font.ui,
                }}
                onMouseEnter={e => {
                  if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                }}
                onMouseLeave={e => {
                  if (!active) e.currentTarget.style.background = 'transparent';
                }}
              >
                {active && !collapsed && (
                  <div style={{
                    position: 'absolute',
                    left: 0,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 3,
                    height: 18,
                    borderRadius: '0 3px 3px 0',
                    background: 'linear-gradient(180deg, #005BC5, #00B4FC)',
                  }} />
                )}
                <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div style={{ padding: collapsed ? '8px' : '8px 10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: tokens.md,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'transparent',
              color: '#64748B',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
              fontFamily: tokens.font.ui,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#94A3B8'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748B'; }}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </aside>

      <main style={{
        flex: 1,
        minWidth: 0,
        padding: '32px 36px',
        maxWidth: 1280,
        background: 'var(--bg)',
      }}>
        {children}
      </main>
    </div>
  );
}
