import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { User } from '@/types';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import AppLoader from '@/components/layout/AppLoader';
import AdminLayout from '@/components/admin/AdminLayout';

const LandingPage = React.lazy(() => import('@/pages/Landing'));
const LoginPage = React.lazy(() => import('@/pages/Login'));
const RegisterPage = React.lazy(() => import('@/pages/Register'));
const CourseListPage = React.lazy(() => import('@/pages/CourseList'));
const CourseDetailPage = React.lazy(() => import('@/pages/CourseDetail'));
const ContentViewerPage = React.lazy(() => import('@/pages/ContentViewer'));
const LearnPage = React.lazy(() => import('@/pages/Learn'));
const DashboardPage = React.lazy(() => import('@/pages/Dashboard'));
const SettingsPage = React.lazy(() => import('@/pages/Settings'));
const AdminDashboardPage = React.lazy(() => import('@/pages/admin/AdminDashboard'));
const AdminUsersPage = React.lazy(() => import('@/pages/admin/AdminUsers'));
const AdminContentPage = React.lazy(() => import('@/pages/admin/AdminContent'));
const AdminSubmissionsPage = React.lazy(() => import('@/pages/admin/AdminSubmissions'));
const AdminCertificatesPage = React.lazy(() => import('@/pages/admin/AdminCertificates'));
const AdminBadgesPage = React.lazy(() => import('@/pages/admin/AdminBadges'));

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let retries = 0;
    const maxRetries = 5;

    function attempt() {
      api.me()
        .then((u) => {
          if (!cancelled) {
            setUser(u && u.authenticated ? u : null);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled && retries < maxRetries) {
            retries++;
            const delay = Math.min(500 * 2 ** retries, 8000);
            setTimeout(attempt, delay);
            return;
          }
          if (!cancelled) {
            setUser(null);
            setLoading(false);
          }
        });
    }

    attempt();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <AppLoader />;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', position: 'relative', zIndex: 1 }}>
        <Suspense fallback={<AppLoader />}>
          <Routes>
            <Route path="/" element={user ? (user.role === 'admin' || user.role === 'instructor' ? <Navigate to="/admin" replace /> : <Navigate to="/courses" replace />) : <LandingPage />} />
            <Route path="/login" element={<LoginPage onLogin={setUser} />} />
            <Route path="/register" element={<RegisterPage onRegister={setUser} />} />

            {/* Authenticated routes with layout */}
            <Route
              path="/courses"
              element={<LayoutWithNav user={user} onLogout={() => setUser(null)}><CourseListPage /></LayoutWithNav>}
            />
            <Route
              path="/courses/:id"
              element={<LayoutWithNav user={user} onLogout={() => setUser(null)}><CourseDetailPage /></LayoutWithNav>}
            />
            <Route
              path="/content/*"
              element={<LayoutWithNav user={user} onLogout={() => setUser(null)}><ContentViewerPage /></LayoutWithNav>}
            />
            <Route
              path="/learn"
              element={<LayoutWithNav user={user} onLogout={() => setUser(null)}><LearnPage /></LayoutWithNav>}
            />
            <Route
              path="/dashboard"
              element={<LayoutWithNav user={user} onLogout={() => setUser(null)}><DashboardPage /></LayoutWithNav>}
            />
            <Route
                path="/settings"
                element={<LayoutWithNav user={user} onLogout={() => setUser(null)}><SettingsPage /></LayoutWithNav>}
              />
              <Route path="/admin" element={<AdminLayout><AdminDashboardPage /></AdminLayout>} />
              <Route path="/admin/users" element={<AdminLayout><AdminUsersPage /></AdminLayout>} />
              <Route path="/admin/content" element={<AdminLayout><AdminContentPage /></AdminLayout>} />
              <Route path="/admin/submissions" element={<AdminLayout><AdminSubmissionsPage /></AdminLayout>} />
              <Route path="/admin/certificates" element={<AdminLayout><AdminCertificatesPage /></AdminLayout>} />
              <Route path="/admin/badges" element={<AdminLayout><AdminBadgesPage /></AdminLayout>} />
          </Routes>
        </Suspense>
        <Footer />
      </div>
    </>
  );
}

function LayoutWithNav({ children, user, onLogout }: { children: React.ReactNode; user: User | null; onLogout?: () => void }) {
  return (
    <>
      <Navbar username={user?.username} onLogout={onLogout} />
      <main style={{ flex: 1 }}>{children}</main>
    </>
  );
}
