import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PartyPopper, Compass } from 'lucide-react';
import { api } from '@/lib/api';

export default function LearnPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .learn()
      .then((res) => {
        if (cancelled) return;
        if ('id' in res) {
          navigate(`/content/${res.id}`, { replace: true });
        } else {
          setDone(true);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'Failed to find the next challenge');
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <p className="mb-3 text-sm font-medium" style={{ color: 'var(--danger)' }}>{error}</p>
          <button
            onClick={() => navigate('/courses')}
            className="rounded-lg px-4 py-2 text-xs font-medium transition-colors"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Back to Courses
          </button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: 'var(--success-glow)' }}>
            <PartyPopper size={28} style={{ color: 'var(--success)' }} />
          </div>
          <h1 className="mb-2 text-2xl font-bold" style={{ color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
            Course complete!
          </h1>
          <p className="mb-6 text-sm" style={{ color: 'var(--text-muted)' }}>
            You finished every challenge in the Responsive Web Design course.
          </p>
          <button
            onClick={() => navigate('/courses')}
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            <Compass size={16} />
            Browse Courses
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Finding your next challenge…
        </p>
      </div>
    </div>
  );
}
