import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowUp } from 'lucide-react';
import { api } from '@/lib/api';
import { invalidateCurriculum } from '@/lib/curriculumCache';
import { ContentDetail } from '@/types';
import BreadcrumbBar from '@/components/content/BreadcrumbBar';
import TreePanel from '@/components/content/TreePanel';
import ArticleRenderer from '@/components/content/ArticleRenderer';
import ProgressBar from '@/components/content/ProgressBar';
import ViewModeToggle from '@/components/content/ViewModeToggle';
import TypeBadge from '@/components/content/TypeBadge';
import LectureContent from '@/components/content/LectureContent';
import TestContent from '@/components/content/TestContent';
import WorkshopContent from '@/components/content/WorkshopContent';
import LabContent from '@/components/content/LabContent';
import CompletionCard from '@/components/content/CompletionCard';

type ViewMode = 'default' | 'maximize' | 'fullscreen';

const VIEW_MODE_CLASSES: Record<ViewMode, string> = {
  default: '',
  maximize: 'max-w-none px-4',
  fullscreen: 'fixed inset-0 z-50 overflow-y-auto bg-[var(--bg)]',
};

export default function ContentViewerPage() {
  const { '*': contentId } = useParams<{ '*': string }>();
  const navigate = useNavigate();
  const cid = contentId ?? '';

  const [content, setContent] = useState<ContentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('default');
  const [treeOpen, setTreeOpen] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .content(cid)
      .then((data) => setContent(data))
      .catch((e) => setError(e.message || 'Failed to load content'))
      .finally(() => setLoading(false));
  }, [cid]);

  const refreshContent = useCallback(() => {
    api
      .content(cid)
      .then((data) => {
        setContent((prev) =>
          prev
            ? {
                ...prev,
                completed: data.completed,
                locked: data.locked,
                step_count: data.step_count,
              }
            : data
        );
      })
      .catch(() => {});
  }, [cid]);

  const handleComplete = useCallback(() => {
    setJustCompleted(true);
    refreshContent();
    invalidateCurriculum(content?.breadcrumb?.[0]?.id);
  }, [refreshContent, content]);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Escape to exit fullscreen
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && viewMode === 'fullscreen') setViewMode('default');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [viewMode]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading content…</p>
        </div>
      </div>
    );
  }

  if (error || !content) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <p className="mb-3 text-sm font-medium" style={{ color: 'var(--danger)' }}>{error || 'Content not found'}</p>
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

  const isWorkshop =
    content.type === 'workshop' && content.assessments?.[0]?.steps && content.assessments[0].steps.length > 0;

  const isLab = content.type === 'practical' && !!content.lab;

  if (isWorkshop) {
    return (
      <div className="relative">
        <ProgressBar />
        <WorkshopContent content={content} onTreeToggle={() => setTreeOpen(!treeOpen)} onComplete={handleComplete} />
        <TreePanel
          open={treeOpen}
          onClose={() => setTreeOpen(false)}
          currentContentId={cid}
          courseId={content.breadcrumb?.[0]?.id}
        />
        <CompletionCard
          open={justCompleted}
          title={content.title || content.name}
          onContinue={() => navigate('/learn')}
          onClose={() => setJustCompleted(false)}
        />
      </div>
    );
  }

  if (isLab) {
    return (
      <div className="relative">
        <ProgressBar />
        <LabContent content={content} onTreeToggle={() => setTreeOpen(!treeOpen)} onComplete={handleComplete} />
        <TreePanel
          open={treeOpen}
          onClose={() => setTreeOpen(false)}
          currentContentId={cid}
          courseId={content.breadcrumb?.[0]?.id}
        />
        <CompletionCard
          open={justCompleted}
          title={content.title || content.name}
          onContinue={() => navigate('/learn')}
          onClose={() => setJustCompleted(false)}
        />
      </div>
    );
  }

  return (
    <div
      className={`relative ${VIEW_MODE_CLASSES[viewMode]} ${
        viewMode === 'default' ? 'mx-auto max-w-4xl px-4 sm:px-6' : 'px-4 sm:px-8'
      }`}
      style={{ paddingTop: viewMode === 'fullscreen' ? '0' : '0' }}
    >
      <ProgressBar />

      {/* Top bar */}
      <div className="sticky top-0 z-40 py-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 overflow-hidden">
            <BreadcrumbBar
              breadcrumbs={content.breadcrumb || []}
              onTreeToggle={() => setTreeOpen(!treeOpen)}
            />
          </div>
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {/* Content header */}
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <TypeBadge type={content.type} />
        </div>
        <h1
          className="text-2xl font-bold leading-tight sm:text-3xl"
          style={{ color: 'var(--text)', fontFamily: 'var(--font-display)' }}
        >
          {content.title || content.name}
        </h1>
      </div>

      {/* Article */}
      <article
        className="pb-24"
        style={{
          maxWidth: viewMode === 'maximize' ? '900px' : undefined,
          margin: viewMode === 'maximize' ? '0 auto' : undefined,
        }}
      >
        {(content.type === 'lecture' || content.type === 'review') && content.lecture_data ? (
          <LectureContent content={content} onComplete={handleComplete} />
        ) : (content.type === 'test' || content.type === 'exam') && content.test_data ? (
          <TestContent content={content} pageSize={content.type === 'exam' ? 10 : 5} onComplete={handleComplete} />
        ) : content.type === 'workshop' && content.assessments?.[0]?.steps && content.assessments[0].steps.length > 0 ? (
          <WorkshopContent content={content} onComplete={handleComplete} />
        ) : (
          <>
            {content.body && (
              <ArticleRenderer markdown={content.body} rewrites={content.rewrites} />
            )}

            {/* Assessments */}
            {content.assessments && content.assessments.length > 0 && (
              <div className="mt-10 space-y-6">
                {content.assessments.map((assessment, i) => (
                  <div
                    key={i}
                    className="rounded-xl p-5"
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    <div className="mb-3 flex items-center gap-2">
                      <TypeBadge type={assessment.type} />
                      <span className="text-xs font-medium capitalize" style={{ color: 'var(--text-secondary)' }}>
                        {assessment.type}
                      </span>
                    </div>

                    {assessment.questions && (
                      <div className="space-y-3">
                        {assessment.questions.map((q, qi) => (
                          <div key={qi} className="rounded-lg p-3" style={{ background: 'var(--bg-elevated)' }}>
                            <p className="mb-2 text-sm font-medium" style={{ color: 'var(--text)' }}>
                              {qi + 1}. {q.question}
                            </p>
                            <div className="grid gap-1.5 sm:grid-cols-2">
                              {q.options.map((opt, oi) => (
                                <div
                                  key={oi}
                                  className="rounded-md px-3 py-1.5 text-xs"
                                  style={{
                                    background: oi === q.correct ? 'var(--success-glow)' : 'var(--bg-card)',
                                    border: `1px solid ${oi === q.correct ? 'var(--success)' : 'var(--border)'}`,
                                    color: oi === q.correct ? 'var(--success)' : 'var(--text-secondary)',
                                  }}
                                >
                                  {opt}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {assessment.steps && (
                      <div className="space-y-3">
                        {assessment.steps.map((step, si) => (
                          <div key={si} className="rounded-lg p-3" style={{ background: 'var(--bg-elevated)' }}>
                            <p className="mb-1 text-sm font-medium" style={{ color: 'var(--text)' }}>
                              Step {si + 1}: {step.title}
                            </p>
                            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                              {step.description}
                            </p>
                            {step.seed && (
                              <pre
                                className="mt-2 overflow-x-auto rounded-lg p-3 text-xs"
                                style={{
                                  background: '#001449',
                                  color: '#E8F0FE',
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                <code>{step.seed}</code>
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {assessment.requirements && (
                      <ul className="space-y-1">
                        {assessment.requirements.map((req, ri) => (
                          <li key={ri} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            <span style={{ color: 'var(--accent)' }}>•</span>
                            <span><strong>{req.label}:</strong> {req.rule}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </article>

      {/* Back to top */}
      {showTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 z-50 flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-all hover:scale-110"
          style={{
            background: 'var(--accent)',
            color: '#fff',
            boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
          }}
        >
          <ArrowUp size={18} />
        </button>
      )}

      {/* Tree panel */}
      <TreePanel
        open={treeOpen}
        onClose={() => setTreeOpen(false)}
        currentContentId={cid}
        courseId={content.breadcrumb?.[0]?.id}
      />

      <CompletionCard
        open={justCompleted}
        title={content.title || content.name}
        onContinue={() => navigate('/learn')}
        onClose={() => setJustCompleted(false)}
      />
    </div>
  );
}
