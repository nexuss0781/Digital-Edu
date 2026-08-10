import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import type { ContentDetail, NoteQuestion } from '@/types';
import ArticleRenderer from './ArticleRenderer';
import TestQuiz from './TestQuiz';

interface TestContentProps {
  content: ContentDetail;
  pageSize?: number;
  onComplete?: () => void;
}

export default function TestContent({ content, pageSize = 5, onComplete }: TestContentProps) {
  const testData = content.test_data;
  const [quizFinished, setQuizFinished] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [finalPassed, setFinalPassed] = useState(false);

  const handleQuizComplete = useCallback(
    (score: number, passed: boolean) => {
      setFinalScore(score);
      setFinalPassed(passed);
      setQuizFinished(true);
      if (passed) {
        api.completeContent(content.id, {
          content_type: content.type,
          score,
          passed: true,
        }).catch(() => {});
      }
      onComplete?.();
    },
    [content.id, onComplete]
  );

  if (!testData) {
    return <ArticleRenderer markdown={content.body} rewrites={content.rewrites} />;
  }

  const toIndex = (v: unknown): number => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^[A-Za-z]$/.test(v)) return v.toUpperCase().charCodeAt(0) - 65;
    return 0;
  };

  const questions: NoteQuestion[] = (content.assessments?.[0]?.questions || []).map((q) => {
    const qq = q as unknown as { question?: string; text?: string; correct?: unknown; correct_index?: unknown; options?: unknown[] };
    return {
      text: qq.question ?? qq.text ?? '',
      options: (qq.options || []).map((o) => {
        const opt = o as { text?: string; feedback?: string } | string;
        return {
          text: typeof opt === 'string' ? opt : (opt?.text ?? ''),
          feedback: typeof opt === 'string' ? null : (opt?.feedback ?? null),
        };
      }),
      correct_index: toIndex(qq.correct ?? qq.correct_index),
    };
  });
  if (!questions.length) {
    return <ArticleRenderer markdown={content.body} rewrites={content.rewrites} />;
  }

  const threshold = testData.pass_threshold ?? testData.question_count;

  return (
    <div className="space-y-6">
      {testData.description && (
        <div
          className="rounded-xl p-4 text-sm"
          style={{
            background: 'rgba(59,130,246,0.08)',
            border: '1px solid rgba(59,130,246,0.2)',
            color: 'var(--text-secondary)',
          }}
        >
          <span className="font-medium" style={{ color: 'var(--text)' }}>
            Passing requirement:
          </span>{' '}
          {testData.description.replace(/^To pass the quiz, /i, '')}
        </div>
      )}

      {!quizFinished && (
        <div className="mt-8">
          <div className="mb-4 flex items-center gap-2">
            <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
            <span
              className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}
            >
              <span>Test Quiz ({testData.question_count} questions)</span>
              <span
                className="rounded-md px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider"
                style={{
                  background: 'rgba(59,130,246,0.12)',
                  color: 'var(--accent, #3b82f6)',
                }}
              >
                Pass: {threshold}/{testData.question_count}
              </span>
            </span>
            <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
          </div>
          <TestQuiz
            questions={questions}
            passThreshold={threshold}
            pageSize={pageSize}
            onComplete={handleQuizComplete}
          />
        </div>
      )}

      {quizFinished && (
        <div
          className="rounded-xl p-6 text-center"
          style={{
            background: finalPassed
              ? 'rgba(22,163,74,0.1)'
              : 'rgba(220,38,38,0.1)',
            border: `1px solid ${
              finalPassed
                ? 'rgba(22,163,74,0.3)'
                : 'rgba(220,38,38,0.3)'
            }`,
          }}
        >
          <div className="mb-2 flex justify-center">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full"
              style={{
                background: finalPassed
                  ? 'rgba(22,163,74,0.15)'
                  : 'rgba(220,38,38,0.15)',
              }}
            >
              {finalPassed ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              )}
            </div>
          </div>
          <h3
            className="mb-1 text-lg font-bold"
            style={{ color: finalPassed ? '#16a34a' : '#dc2626' }}
          >
            {finalPassed ? 'Test Passed!' : 'Test Failed'}
          </h3>
          <p className="mb-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            You scored {finalScore} out of {testData.question_count}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {finalPassed
              ? 'Great work! You can proceed to the next lesson.'
              : `You needed at least ${threshold}/${testData.question_count} to pass. Try again!`}
          </p>
          {finalPassed && (
            <button
              onClick={() => {
                window.location.reload();
              }}
              className="mt-4 rounded-lg px-6 py-2.5 text-sm font-medium transition-all hover:scale-105"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Continue
            </button>
          )}
        </div>
      )}
    </div>
  );
}
