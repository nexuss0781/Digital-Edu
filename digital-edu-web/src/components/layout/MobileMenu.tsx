import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { LogOut, BookOpen, LayoutDashboard, Settings, GraduationCap } from 'lucide-react';
import { api, showToast } from '@/lib/api';

const LINKS = [
  { href: '/learn', label: 'Learn', icon: GraduationCap },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/courses', label: 'Courses', icon: BookOpen },
  { href: '/settings', label: 'Settings', icon: Settings },
];

type Props = {
  open: boolean;
  onClose: () => void;
  username?: string;
  onLogout?: () => void;
};

export default function MobileMenu({ open, onClose, username, onLogout }: Props) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await api.logout();
      showToast('Logged out');
    } catch {
      showToast('Failed to log out', true);
    } finally {
      onLogout?.();
      setLoggingOut(false);
      onClose();
      navigate('/login');
    }
  };

  return (
    <>
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            top: 56,
            zIndex: 998,
            backgroundColor: 'rgba(0,0,0,0.5)',
          }}
        />
      )}
      <div
        style={{
          position: 'fixed',
          top: 56,
          left: 0,
          right: 0,
          zIndex: 999,
          backgroundColor: '#1a1b2e',
          borderBottom: '1px solid #012677',
          transform: open ? 'translateY(0)' : 'translateY(-100%)',
          opacity: open ? 1 : 0,
          transition: 'transform 0.25s ease, opacity 0.25s ease',
          pointerEvents: open ? 'auto' : 'none',
          padding: '12px 20px 20px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {LINKS.map((link) => {
            const Icon = link.icon;
            const active = pathname === link.href || pathname.startsWith(link.href + '/');
            return (
              <Link
                key={link.href}
                to={link.href}
                onClick={onClose}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 500,
                  color: active ? '#17F9FF' : '#CBD5E1',
                  backgroundColor: active ? 'rgba(23,249,255,0.08)' : 'transparent',
                  textDecoration: 'none',
                }}
              >
                <Icon size={18} />
                {link.label}
              </Link>
            );
          })}

          <div style={{ borderTop: '1px solid #012677', margin: '8px 0' }} />

          {username && (
            <div
              style={{
                padding: '8px 14px',
                fontSize: 13,
                color: '#64748b',
                fontWeight: 500,
              }}
            >
              Signed in as {username}
            </div>
          )}

          <button
            onClick={handleLogout}
            disabled={loggingOut}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 14px',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 500,
              color: '#F87171',
              background: 'none',
              border: 'none',
              cursor: loggingOut ? 'default' : 'pointer',
              width: '100%',
            }}
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </div>
    </>
  );
}
