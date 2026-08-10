import { useNavigate } from 'react-router-dom';
import { Home, Play, Clock, BookOpen, Layers, CheckCircle2 } from 'lucide-react';
import { CourseDetail } from '@/types';

export default function CourseHero({ course, nextContentId }: { course: CourseDetail; nextContentId?: string }) {
  const navigate = useNavigate();
  const pct = course.progress_pct || 0;
  const isStarted = course.completed_count > 0;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        overflow: 'hidden',
        borderRadius: 20,
        marginBottom: 24,
      }}
    >
      {/* Water/glass blurred background */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <img
          src={course.image || '/images/course-placeholder.svg'}
          alt=""
          style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', filter: 'blur(28px) saturate(1.2)', transform: 'scale(1.15)' }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 45%, rgba(10,20,40,0.28) 100%)',
          }}
        />
      </div>

      {/* Content */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          gap: 36,
          padding: '40px 36px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        {/* Sharp poster card on top */}
        <div
          style={{
            width: 220,
            height: 300,
            flexShrink: 0,
            borderRadius: 16,
            overflow: 'hidden',
            boxShadow: '0 24px 60px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.25)',
            border: '1px solid rgba(255,255,255,0.35)',
          }}
        >
          <img
            src={course.image || '/images/course-placeholder.svg'}
            alt={course.name}
            width={220}
            height={300}
            style={{ objectFit: 'cover', width: '100%', height: '100%' }}
          />
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 280 }}>
          <h1
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: '#ffffff',
              fontFamily: 'var(--font-display)',
              lineHeight: 1.2,
              marginBottom: 16,
            }}
          >
            {course.name}
          </h1>

          {/* Meta badges */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <MetaBadge icon={<Layers size={14} />} value={course.section_count} label="Sections" />
            <MetaBadge icon={<BookOpen size={14} />} value={course.total} label="Lessons" />
            {course.expected_hours && (
              <MetaBadge icon={<Clock size={14} />} value={course.expected_hours} label="Hours" />
            )}
            {course.completed_count > 0 && (
              <MetaBadge icon={<CheckCircle2 size={14} />} value={course.completed_count} label="Done" />
            )}
          </div>

          {/* Description */}
          {course.description && (
            <p
              style={{
                fontSize: 14,
                color: 'rgba(255,255,255,0.65)',
                lineHeight: 1.6,
                marginBottom: 20,
                maxWidth: 560,
              }}
            >
              {course.description}
            </p>
          )}

          {/* Progress bar */}
          {isStarted && (
            <div style={{ marginBottom: 24, maxWidth: 400 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Progress</span>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>
                  {pct}%
                </span>
              </div>
              <div
                style={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    borderRadius: 4,
                    background: 'linear-gradient(90deg, var(--accent), var(--accent-light))',
                    transition: 'width 0.6s ease',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      right: -4,
                      top: -4,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      backgroundColor: 'var(--accent-light)',
                      boxShadow: '0 0 12px var(--accent), 0 0 24px var(--accent)',
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* CTA buttons */}
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => navigate('/courses')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.2)',
                backgroundColor: 'transparent',
                color: '#ffffff',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)')}
            >
              <Home size={16} />
              Home
            </button>
            <button
              onClick={() => navigate('/learn')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 24px',
                borderRadius: 10,
                border: 'none',
                background: 'linear-gradient(135deg, var(--accent), var(--accent-light))',
                color: '#ffffff',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(0,91,197,0.3)',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,91,197,0.4)')}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,91,197,0.3)')}
            >
              <Play size={16} />
              {isStarted ? 'Continue Learning' : 'Start Learning'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaBadge({ icon, value, label }: { icon: React.ReactNode; value: number | string; label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <span style={{ color: 'var(--accent-light)' }}>{icon}</span>
      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>{value}</span>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{label}</span>
    </div>
  );
}
