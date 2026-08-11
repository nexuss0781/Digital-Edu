import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { CourseListItem } from '@/types';

const TYPE_COLORS: Record<string, string> = {
  note: 'var(--accent)',
  quiz: '#F59E0B',
  test: '#001449',
  exam: '#00B4FC',
  workshop: '#17F9FF',
  practical: 'var(--accent-light)',
  project: '#012677',
};

export default function CourseCard({ course, index }: { course: CourseListItem; index: number }) {
  const navigate = useNavigate();
  const lessons = course.total || 0;
  const completed = course.completed_count || 0;
  const pct = lessons > 0 ? Math.round((completed / lessons) * 100) : 0;

  return (
    <div
      onClick={() => navigate(`/courses/${course.id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/courses/${course.id}`)}
      className="animate-fade-in"
      style={{
        animationDelay: `${index * 60}ms`,
        animationFillMode: 'both',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: 16,
        borderRadius: 14,
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--accent)',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-3px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Image */}
      <div
        style={{
          width: 180,
          height: 110,
          flexShrink: 0,
          borderRadius: 10,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <img
          src={course.image || '/images/course-placeholder.svg'}
          alt={course.name}
          style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(90deg, transparent 50%, var(--bg-card) 100%)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--text)',
            marginBottom: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {course.name}
        </h3>
        <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {course.section_count || 0} sections
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {lessons} lessons
          </span>
        </div>
        {course.description && (
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-secondary)',
              lineHeight: 1.4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              marginBottom: 8,
            }}
          >
            {course.description}
          </p>
        )}
        {/* Progress */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              backgroundColor: 'var(--bg-elevated)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                borderRadius: 3,
                background: 'linear-gradient(90deg, var(--accent), var(--accent-light))',
                transition: 'width 0.4s ease',
              }}
            />
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {completed}/{lessons}
          </span>
        </div>
      </div>

      {/* Chevron */}
      <ChevronRight
        size={20}
        className="course-chevron"
        style={{
          color: 'var(--text-muted)',
          flexShrink: 0,
          transition: 'color 0.2s, transform 0.2s',
        }}
      />
    </div>
  );
}
