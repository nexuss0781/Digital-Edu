import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';
import { AdminSubmission } from '@/types';
import { useToast } from '@/components/ui/Toast';
import { CheckCircle, RotateCcw, FileCode } from 'lucide-react';
import {
  tokens, page, PageHeader, Badge, primaryBtn, secondaryBtn,
  sectionCard, EmptyState, LoadingState,
} from '@/styles/admin';

export default function AdminSubmissionsPage() {
  const { toast } = useToast();
  const [submissions, setSubmissions] = useState<AdminSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.submissions()
      .then(setSubmissions)
      .catch(() => toast('Failed to load submissions', true))
      .finally(() => setLoading(false));
  }, []);

  const handleVerdict = async (id: number, verdict: string) => {
    try {
      await adminApi.submissionVerdict(id, verdict);
      toast('Verdict saved');
      setSubmissions(prev => prev.map(s => s.id === id ? { ...s, verdict } : s));
    } catch (err: any) {
      toast(err.message || 'Failed', true);
    }
  };

  const verdictBadge = (verdict: string | null) => {
    if (!verdict || verdict === 'pending') {
      return <Badge variant="warning">Pending</Badge>;
    }
    if (verdict === 'passed') {
      return <Badge variant="success">Passed</Badge>;
    }
    if (verdict === 'retry') {
      return <Badge variant="danger">Retry</Badge>;
    }
    return <Badge>{verdict}</Badge>;
  };

  if (loading) {
    return (
      <div style={page}>
        <PageHeader title="Project Submissions" />
        <LoadingState />
      </div>
    );
  }

  return (
    <div style={page}>
      <PageHeader
        title="Project Submissions"
        subtitle={
          submissions.length > 0
            ? `${submissions.length} pending submission${submissions.length !== 1 ? 's' : ''}`
            : 'Review and verdict student projects'
        }
      />

      {submissions.length === 0 ? (
        <EmptyState
          icon={<FileCode size={40} />}
          message="No pending submissions"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {submissions.map(s => (
            <div key={s.id} style={{
              ...sectionCard,
              padding: '20px 24px',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', marginBottom: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: tokens.md,
                    background: 'linear-gradient(135deg, var(--accent), var(--accent-light))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 14, color: '#fff',
                    fontFamily: tokens.font.ui,
                  }}>
                    {s.username ? s.username[0].toUpperCase() : '?'}
                  </div>
                  <div>
                    <div style={{
                      fontWeight: 600, fontSize: tokens.size.md,
                      color: 'var(--text)', fontFamily: tokens.font.ui,
                    }}>
                      {s.username}
                    </div>
                    <div style={{
                      fontSize: tokens.size.sm, color: 'var(--text-muted)',
                      fontFamily: tokens.font.mono, marginTop: 1,
                    }}>
                      {s.content_id}
                    </div>
                  </div>
                </div>
                {verdictBadge(s.verdict)}
              </div>

              <pre style={{
                fontSize: tokens.size.sm,
                padding: 16,
                borderRadius: tokens.md,
                overflowX: 'auto',
                marginBottom: 14,
                maxHeight: 200,
                background: '#0D1117',
                color: '#E8F0FE',
                fontFamily: tokens.font.mono,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                border: '1px solid #21262D',
                lineHeight: 1.5,
              }}>
                {s.submission}
              </pre>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => handleVerdict(s.id, 'passed')}
                  style={{
                    ...primaryBtn(),
                    background: 'var(--success)',
                  }}
                >
                  <CheckCircle size={14} /> Pass
                </button>
                <button
                  onClick={() => handleVerdict(s.id, 'retry')}
                  style={{
                    ...secondaryBtn(),
                    color: '#D97706',
                  }}
                >
                  <RotateCcw size={14} /> Request Retry
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
