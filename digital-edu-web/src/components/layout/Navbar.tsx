import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '@/components/layout/ThemeProvider';
import { useGlass } from './ThemeProvider';
import { Sun, Moon, Diamond, Menu, LogOut, User, X } from 'lucide-react';
import MobileMenu from './MobileMenu';
import { api, showToast } from '@/lib/api';

const NAV_LINKS = [
  { href: '/learn', label: 'Learn' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/courses', label: 'Courses' },
  { href: '/settings', label: 'Settings' },
];

export default function Navbar({ username, onLogout }: { username?: string; onLogout?: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { glass, toggleGlass } = useGlass();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const isDark = theme === 'dark';

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
      navigate('/login');
    }
  };

  return (
    <>
      <nav
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1000,
          backgroundColor: glass ? 'rgba(26,27,46,0.85)' : '#1a1b2e',
          borderBottom: '1px solid #012677',
          backdropFilter: glass ? 'blur(16px) saturate(1.4)' : 'none',
          WebkitBackdropFilter: glass ? 'blur(16px) saturate(1.4)' : 'none',
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            padding: '0 20px',
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* Logo */}
          <Link
            to="/courses"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            <img src="/images/logo.svg" alt="DigitalEdu" width={28} height={28} />
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: '#17F9FF',
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.02em',
              }}
            >
              DigitalEdu
            </span>
          </Link>

          {/* Desktop nav links */}
          <div
            className="hidden md:flex"
            style={{ alignItems: 'center', gap: 4 }}
          >
            {NAV_LINKS.map((link) => {
              const active = pathname === link.href || pathname.startsWith(link.href + '/');
              return (
                <Link
                  key={link.href}
                  to={link.href}
                  style={{
                    padding: '6px 16px',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 500,
                    color: active ? '#17F9FF' : '#CBD5E1',
                    backgroundColor: active ? 'rgba(23,249,255,0.08)' : 'transparent',
                    textDecoration: 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* Desktop right side */}
          <div
            className="hidden md:flex"
            style={{ alignItems: 'center', gap: 6 }}
          >
            <NavIconBtn
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            >
              {isDark ? <Sun size={17} /> : <Moon size={17} />}
            </NavIconBtn>
            <NavIconBtn
              onClick={toggleGlass}
              label="Toggle glass mode"
              active={glass}
            >
              <Diamond size={17} />
            </NavIconBtn>

            {username && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 12px 4px 6px',
                  borderRadius: 20,
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  marginLeft: 4,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    backgroundColor: '#012677',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <User size={14} color="#17F9FF" />
                </div>
                <span style={{ fontSize: 13, color: '#CBD5E1', fontWeight: 500 }}>
                  {username}
                </span>
              </div>
            )}

            <button
              onClick={handleLogout}
              disabled={loggingOut}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: 8,
                color: '#CBD5E1',
                background: 'none',
                border: 'none',
                cursor: loggingOut ? 'default' : 'pointer',
                transition: 'color 0.15s',
              }}
              title="Logout"
            >
              <LogOut size={16} />
            </button>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: 8,
              border: 'none',
              backgroundColor: 'transparent',
              color: '#CBD5E1',
              cursor: 'pointer',
            }}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>

      <MobileMenu
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        username={username}
        onLogout={onLogout}
      />
    </>
  );
}

function NavIconBtn({
  onClick,
  label,
  active,
  children,
}: {
  onClick: () => void;
  label: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 34,
        height: 34,
        borderRadius: 8,
        border: 'none',
        backgroundColor: active ? 'rgba(23,249,255,0.12)' : 'transparent',
        color: active ? '#17F9FF' : '#CBD5E1',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}
