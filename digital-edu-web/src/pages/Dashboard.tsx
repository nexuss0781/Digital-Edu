import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CheckCircle2, Flame, Award, ArrowRight, BarChart3 } from 'lucide-react';
import { api } from '@/lib/api';
import { CourseListItem, BadgeItem } from '@/types';

interface ActivityData {
  [date: string]: { count: number };
}

export default function DashboardPage() {
  const [username, setUsername] = useState('');
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [badges, setBadges] = useState<BadgeItem[]>([]);
  const [streak, setStreak] = useState(0);
  const [activity, setActivity] = useState<ActivityData>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.me().catch(() => null),
      api.courses().catch(() => []),
      api.activity().catch((): ActivityData => ({})),
      api.badges().catch(() => []),
      api.streak().catch(() => ({ streak: 0 })),
    ]).then(([meRes, coursesRes, actRes, badgesRes, streakRes]) => {
      if (meRes?.username) setUsername(meRes.username);
      if (Array.isArray(coursesRes)) setCourses(coursesRes);
      if (actRes && typeof actRes === 'object') setActivity(actRes);
      if (Array.isArray(badgesRes)) setBadges(badgesRes);
      if (streakRes?.streak) setStreak(streakRes.streak);
      setLoading(false);
    });
  }, []);

  const inProgress = courses.filter(
    (c) => c.completed_count > 0 && c.completed_count < c.total
  ).slice(0, 3);

  const totalLessons = courses.reduce((acc, c) => acc + c.completed_count, 0);

  const stats = [
    { label: 'Courses In Progress', value: inProgress.length, icon: <BookOpen size={20} />, color: 'var(--accent)' },
    { label: 'Lessons Completed', value: totalLessons, icon: <CheckCircle2 size={20} />, color: 'var(--success)' },
    { label: 'Current Streak', value: `${streak}d`, icon: <Flame size={20} />, color: 'var(--color-gold)' },
    { label: 'Badges Earned', value: badges.length, icon: <Award size={20} />, color: 'var(--color-cyan)' },
  ];

  const activityWeeks = (() => {
    const weeks: string[][] = [];
    const now = new Date();
    for (let w = 11; w >= 0; w--) {
      const week: string[] = [];
      for (let d = 6; d >= 0; d--) {
        const date = new Date(now);
        date.setDate(date.getDate() - (w * 7 + d));
        week.push(date.toISOString().slice(0, 10));
      }
      weeks.push(week);
    }
    return weeks;
  })();

  const maxActivity = Math.max(1, ...Object.values(activity).map((a) => a.count));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1
          className="text-2xl font-bold sm:text-3xl"
          style={{ color: 'var(--text)', fontFamily: 'var(--font-display)' }}
        >
          Welcome{username ? `, ${username}` : ''}
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Track your learning progress and pick up where you left off.
        </p>
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl p-4"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div className="mb-2 flex items-center gap-2" style={{ color: s.color }}>
              {s.icon}
            </div>
            <div
              className="text-2xl font-bold"
              style={{ color: 'var(--text)', fontFamily: 'var(--font-display)' }}
            >
              {loading ? (
                <div className="skeleton-shimmer h-7 w-12" />
              ) : (
                s.value
              )}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Recent Courses */}
        <div className="lg:col-span-3">
          <div className="mb-4 flex items-center justify-between">
            <h2
              className="text-sm font-bold"
              style={{ color: 'var(--text)', fontFamily: 'var(--font-display)' }}
            >
              Continue Learning
            </h2>
            <Link
              to="/courses"
              className="flex items-center gap-1 text-xs font-medium transition-colors"
              style={{ color: 'var(--accent)' }}
            >
              View All <ArrowRight size={12} />
            </Link>
          </div>

          <div className="space-y-3">
            {loading &&
              [1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="rounded-xl p-4"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                >
                  <div className="skeleton-shimmer mb-2 h-4 w-40" />
                  <div className="skeleton-shimmer h-2 w-full" />
                </div>
              ))}

            {!loading && inProgress.length === 0 && (
              <div
                className="rounded-xl p-8 text-center"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
              >
                <BookOpen size={32} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  No courses in progress yet.
                </p>
                <Link
                  to="/courses"
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium"
                  style={{ color: 'var(--accent)' }}
                >
                  Browse Courses <ArrowRight size={12} />
                </Link>
              </div>
            )}

            {!loading &&
              inProgress.map((course) => {
                const pct = course.total > 0 ? Math.round((course.completed_count / course.total) * 100) : 0;
                return (
                  <Link
                    key={course.id}
                    to={`/courses/${course.id}`}
                    className="block rounded-xl p-4 transition-all hover:-translate-y-0.5"
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span
                        className="truncate text-sm font-semibold"
                        style={{ color: 'var(--text)' }}
                      >
                        {course.name}
                      </span>
                      <span className="ml-2 shrink-0 text-xs font-medium" style={{ color: 'var(--accent)' }}>
                        {pct}%
                      </span>
                    </div>
                    <div
                      className="h-1.5 w-full overflow-hidden rounded-full"
                      style={{ background: 'var(--border)' }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          background: 'linear-gradient(90deg, var(--accent), var(--accent-light))',
                        }}
                      />
                    </div>
                    <div className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {course.completed_count}/{course.total} lessons
                    </div>
                  </Link>
                );
              })}
          </div>
        </div>

        {/* Activity Graph */}
        <div className="lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 size={14} style={{ color: 'var(--text-muted)' }} />
            <h2
              className="text-sm font-bold"
              style={{ color: 'var(--text)', fontFamily: 'var(--font-display)' }}
            >
              Activity
            </h2>
          </div>

          <div
            className="rounded-xl p-4"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            {loading ? (
              <div className="skeleton-shimmer h-[110px] w-full" />
            ) : (
              <div className="flex gap-[3px] overflow-x-auto pb-2">
                {activityWeeks.map((week, wi) => (
                  <div key={wi} className="flex flex-col gap-[3px]">
                    {week.map((day) => {
                      const count = activity[day]?.count || 0;
                      const opacity = count === 0 ? 0.12 : Math.min(0.3 + (count / maxActivity) * 0.7, 1);
                      return (
                        <div
                          key={day}
                          className="h-[13px] w-[13px] rounded-[3px] transition-colors"
                          title={`${day}: ${count} actions`}
                          style={{
                            background: count > 0 ? 'var(--accent)' : 'var(--border)',
                            opacity: count > 0 ? opacity : 1,
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-2 flex items-center justify-end gap-1">
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Less</span>
              {[0.15, 0.35, 0.55, 0.8, 1].map((op, i) => (
                <div
                  key={i}
                  className="h-[10px] w-[10px] rounded-[2px]"
                  style={{ background: 'var(--accent)', opacity: i === 0 ? 0.12 : op }}
                />
              ))}
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>More</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
