import { useState } from 'react';
import { CheckCircle, XCircle, ArrowRight, ArrowLeft, Award, X, ClipboardCheck } from 'lucide-react';
import type { NoteQuestion } from '@/types';

interface TestQuizProps {
  questions: NoteQuestion[];
  passThreshold: number;
  pageSize?: number;
  onComplete: (score: number, passed: boolean) => void;
}

export default function TestQuiz({ questions, passThreshold, pageSize = 5, onComplete }: TestQuizProps) {
  const total = questions.length;
  const PAGE_SIZE = pageSize;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const [shuffledQuestions] = useState(() => {
    const shuffle = (q: NoteQuestion): NoteQuestion => {
      const entries = q.options.map((opt, i) => ({ opt, orig: i }));
      for (let i = entries.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [entries[i], entries[j]] = [entries[j], entries[i]];
      }
      return {
        ...q,
        options: entries.map((e) => e.opt),
        correct_index: entries.findIndex((e) => e.orig === q.correct_index),
      };
    };
    return questions.map(shuffle);
  });
  const [page, setPage] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [checkedPages, setCheckedPages] = useState<Set<number>>(new Set());
  const [pageScores, setPageScores] = useState<Record<number, number>>({});
  const [quizComplete, setQuizComplete] = useState(false);

  const pageStart = page * PAGE_SIZE;
  const pageQuestions = shuffledQuestions.slice(pageStart, pageStart + PAGE_SIZE);
  const isChecked = checkedPages.has(page);
  const allAnswered = pageQuestions.every((_, i) => answers[pageStart + i] !== undefined);
  const score = Object.values(pageScores).reduce((a, b) => a + b, 0);
  const answeredCount = Object.keys(answers).length;

  const select = (qIndex: number, oi: number) => {
    if (isChecked) return;
    setAnswers((prev) => ({ ...prev, [qIndex]: oi }));
  };

  const checkPage = () => {
    if (!allAnswered || isChecked) return;
    let gained = 0;
    pageQuestions.forEach((_, i) => {
      const qIndex = pageStart + i;
      if (answers[qIndex] === shuffledQuestions[qIndex].correct_index) gained += 1;
    });
    setPageScores((prev) => ({ ...prev, [page]: gained }));
    setCheckedPages((prev) => new Set(prev).add(page));
    window.setTimeout(() => {
      if (page < pageCount - 1) {
        setPage(page + 1);
      } else {
        setQuizComplete(true);
      }
    }, 1400);
  };

  const goNext = () => {
    if (page < pageCount - 1) {
      setPage(page + 1);
    } else {
      setQuizComplete(true);
    }
  };

  const goPrev = () => {
    if (page > 0) setPage(page - 1);
  };

  if (quizComplete) {
    const passed = score >= passThreshold;
    return (
      <div className="rounded-xl p-6 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="mb-3 flex justify-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full"
            style={{
              background: passed ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.12)',
            }}
          >
            {passed ? (
              <Award size={28} style={{ color: '#16a34a' }} />
            ) : (
              <X size={28} style={{ color: '#dc2626' }} />
            )}
          </div>
        </div>
        <h3 className="mb-1 text-lg font-bold" style={{ color: 'var(--text)' }}>
          {passed ? 'Test Complete!' : 'Test Failed'}
        </h3>
        <p className="mb-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          You scored {score} out of {total}
        </p>
        <p className="mb-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          {passed
            ? 'Great work!'
            : `You needed at least ${passThreshold}/${total} to pass.`}
        </p>
        <button
          onClick={() => onComplete(score, passed)}
          className="rounded-lg px-6 py-2.5 text-sm font-medium transition-all hover:scale-105"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {passed ? 'Complete Test' : 'Review Results'}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      {/* Header */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            Question {pageStart + 1}–{pageStart + pageQuestions.length} of {total}
          </span>
          <div className="flex items-center gap-2">
            {pageScores[page] !== undefined && (
              <span className="text-xs font-semibold" style={{ color: '#16a34a' }}>
                +{pageScores[page]} this page
              </span>
            )}
            <span
              className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                background: 'rgba(59,130,246,0.1)',
                color: 'var(--accent, #3b82f6)',
              }}
            >
              Score: {score}/{total}
            </span>
            <span
              className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                background: score >= passThreshold ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)',
                color: score >= passThreshold ? '#16a34a' : '#dc2626',
              }}
            >
              Pass: {passThreshold}
            </span>
          </div>
        </div>

        <div className="relative h-2 rounded-full" style={{ background: 'var(--border)' }}>
          <div
            className="absolute left-0 top-0 h-full rounded-full transition-all duration-300"
            style={{
              width: `${(answeredCount / total) * 100}%`,
              background: 'linear-gradient(90deg, #16a34a, #4ade80)',
            }}
          />
          <div
            className="absolute top-0 h-full w-0.5 -translate-y-0.5 rounded-full"
            style={{
              left: `${(passThreshold / total) * 100}%`,
              background: '#dc2626',
              height: '200%',
            }}
          />
        </div>

        <div className="mt-2 flex gap-1">
          {Array.from({ length: pageCount }).map((_, i) => (
            <div
              key={i}
              className="h-1 flex-1 rounded-full transition-colors"
              style={{
                background: checkedPages.has(i)
                  ? '#16a34a'
                  : i === page
                  ? 'var(--accent)'
                  : 'var(--border)',
              }}
            />
          ))}
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-6">
        {pageQuestions.map((q, i) => {
          const qIndex = pageStart + i;
          const selected = answers[qIndex];

          return (
            <div key={qIndex}>
              <p className="mb-3 text-sm font-medium leading-relaxed" style={{ color: 'var(--text)' }}>
                <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: 'var(--border)', color: 'var(--text-muted)' }}>
                  {qIndex + 1}
                </span>
                {q.text}
              </p>

              <div className="space-y-2">
                {q.options.map((opt, oi) => {
                  const isSelected = selected === oi;
                  let borderColor = 'var(--border)';
                  let bgColor = 'var(--bg-elevated)';
                  let textColor = 'var(--text-secondary)';

                  if (isChecked && oi === q.correct_index) {
                    borderColor = '#16a34a';
                    bgColor = 'rgba(22,163,74,0.12)';
                    textColor = '#16a34a';
                  } else if (isChecked && isSelected) {
                    borderColor = '#dc2626';
                    bgColor = 'rgba(220,38,38,0.1)';
                    textColor = '#dc2626';
                  } else if (isSelected) {
                    borderColor = 'var(--accent)';
                    bgColor = 'rgba(59,130,246,0.08)';
                    textColor = 'var(--text)';
                  }

                  return (
                    <div key={oi}>
                      <button
                        onClick={() => select(qIndex, oi)}
                        disabled={isChecked}
                        className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm transition-all"
                        style={{
                          background: bgColor,
                          border: `1px solid ${borderColor}`,
                          color: textColor,
                          cursor: isChecked ? 'default' : 'pointer',
                          opacity: isChecked && !isSelected && oi !== q.correct_index ? 0.6 : 1,
                        }}
                      >
                        <span
                          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium"
                          style={{
                            background: isChecked && oi === q.correct_index
                              ? '#16a34a'
                              : isChecked && isSelected
                              ? '#dc2626'
                              : isSelected
                              ? 'var(--accent)'
                              : 'var(--border)',
                            color: isChecked || isSelected ? '#fff' : 'var(--text-muted)',
                          }}
                        >
                          {isChecked && oi === q.correct_index ? (
                            <CheckCircle size={14} />
                          ) : isChecked && isSelected ? (
                            <XCircle size={14} />
                          ) : (
                            String.fromCharCode(65 + oi)
                          )}
                        </span>
                        <span className="flex-1">{opt.text}</span>
                      </button>

                      {isChecked && isSelected && oi !== q.correct_index && opt.feedback && (
                        <div
                          className="mt-1 ml-9 rounded-md px-3 py-2 text-xs"
                          style={{
                            background: 'rgba(220,38,38,0.08)',
                            color: '#dc2626',
                            border: '1px solid rgba(220,38,38,0.2)',
                          }}
                        >
                          {opt.feedback}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-6 flex items-center justify-between border-t pt-4" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={goPrev}
          disabled={page === 0}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{
            color: page === 0 ? 'var(--text-muted)' : 'var(--text-secondary)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            cursor: page === 0 ? 'default' : 'pointer',
            opacity: page === 0 ? 0.5 : 1,
          }}
        >
          <ArrowLeft size={15} />
          Back
        </button>

        {!isChecked ? (
          <button
            onClick={checkPage}
            disabled={!allAnswered}
            className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all"
            style={{
              background: allAnswered ? 'linear-gradient(135deg, var(--accent), var(--accent-light))' : 'var(--border)',
              color: allAnswered ? '#fff' : 'var(--text-muted)',
              cursor: allAnswered ? 'pointer' : 'default',
            }}
          >
            <ClipboardCheck size={16} />
            Check Answers
          </button>
        ) : (
          <button
            onClick={goNext}
            className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all hover:scale-105"
            style={{
              background: 'linear-gradient(135deg, var(--accent), var(--accent-light))',
              color: '#fff',
            }}
          >
            {page < pageCount - 1 ? 'Next Page' : 'Finish Test'}
            <ArrowRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
