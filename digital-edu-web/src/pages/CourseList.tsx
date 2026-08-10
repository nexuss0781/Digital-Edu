import { useState, useEffect, useMemo } from 'react';
import { Search, BookOpen, GraduationCap, CheckCircle2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { CourseListItem } from '@/types';
import CourseCard from '@/components/courses/CourseCard';

const FILTERS = ['All', 'In Progress', 'Completed', 'Not Started'] as const;
type FilterType = (typeof FILTERS)[number];

function SkeletonList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="animate-fade-in"
          style={{
            animationDelay: `${i * 80}ms`,
            animationFillMode: 'both',
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            padding: 16,
            borderRadius: 14,
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderLeft: '3px solid var(--border)',
          }}
        >
          <div className="skeleton-shimmer" style={{ width: 180, height: 110, borderRadius: 10, flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="skeleton-shimmer" style={{ width: '50%', height: 18 }} />
            <div className="skeleton-shimmer" style={{ width: '30%', height: 12 }} />
            <div className="skeleton-shimmer" style={{ width: '100%', height: 12 }} />
            <div className="skeleton-shimmer" style={{ width: '100%', height: 6, borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CoursesPage() {
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('All');

  useEffect(() => {
    api
      .courses()
      .then((data) => setCourses(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const totalCourses = courses.length;
    let totalLessons = 0;
    let totalCompleted = 0;
    courses.forEach((c) => {
      totalLessons += c.total || 0;
      totalCompleted += c.completed_count || 0;
    });
    return { totalCourses, totalLessons, totalCompleted };
  }, [courses]);

  const filtered = useMemo(() => {
    let result = courses;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.description && c.description.toLowerCase().includes(q))
      );
    }

    if (activeFilter !== 'All') {
      result = result.filter((c) => {
        const pct = c.total ? c.completed_count / c.total : 0;
        switch (activeFilter) {
          case 'Completed':
            return pct >= 1 && c.total > 0;
          case 'In Progress':
            return pct > 0 && pct < 1;
          case 'Not Started':
            return pct === 0;
          default:
            return true;
        }
      });
    }

    return result;
  }, [courses, search, activeFilter]);

  return (
    <div
      className="animate-fade-in"
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '32px 20px 60px',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: 'var(--text)',
            fontFamily: 'var(--font-display)',
            marginBottom: 6,
          }}
        >
          Courses
        </h1>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', marginBottom: 24 }}>
          Browse and track your learning journey
        </p>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <StatCard icon={<BookOpen size={18} />} label="Courses" value={stats.totalCourses} />
          <StatCard icon={<GraduationCap size={18} />} label="Lessons" value={stats.totalLessons} />
          <StatCard icon={<CheckCircle2 size={18} />} label="Completed" value={stats.totalCompleted} />
        </div>
      </div>

      {/* Search + Filters */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <Search
            size={18}
            style={{
              position: 'absolute',
              left: 14,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            type="text"
            placeholder="Search courses..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 40px 12px 42px',
              borderRadius: 12,
              border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text)',
              fontSize: 14,
              outline: 'none',
              transition: 'border-color 0.2s',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
            onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              style={{
                padding: '7px 16px',
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 500,
                border: '1px solid',
                borderColor: activeFilter === f ? 'var(--accent)' : 'var(--border)',
                backgroundColor: activeFilter === f ? 'var(--accent-glow-strong)' : 'var(--bg-card)',
                color: activeFilter === f ? 'var(--accent)' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Result count */}
        {(search || activeFilter !== 'All') && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>
            {filtered.length} {filtered.length === 1 ? 'result' : 'results'} found
          </p>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <SkeletonList />
      ) : error ? (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            color: 'var(--danger)',
            fontSize: 14,
          }}
        >
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            padding: 60,
            textAlign: 'center',
            color: 'var(--text-muted)',
          }}
        >
          <BookOpen size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
          <p style={{ fontSize: 15 }}>No courses found</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {filtered.map((course, i) => (
            <CourseCard key={course.id} course={course} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 18px',
        borderRadius: 12,
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: 'var(--accent-glow-strong)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent)',
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );
}
