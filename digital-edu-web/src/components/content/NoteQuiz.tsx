import { useState, useCallback, useEffect } from 'react';
import { CheckCircle, XCircle, ArrowRight, Award } from 'lucide-react';
import type { NoteQuestion } from '@/types';

interface NoteQuizProps {
  questions: NoteQuestion[];
  onComplete: (score: number) => void;
}

export default function NoteQuiz({ questions, onComplete }: NoteQuizProps) {
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [score, setScore] = useState(0);
  const [quizComplete, setQuizComplete] = useState(false);

  const current = shuffledQuestions[currentIndex];
  const total = shuffledQuestions.length;

  const handleSelect = useCallback(
    (optionIndex: number) => {
      if (isCorrect === true) return;
      setSelectedIndex(optionIndex);
      setShowFeedback(false);

      if (optionIndex === current.correct_index) {
        setIsCorrect(true);
        setScore((s) => s + 1);
      } else {
        setIsCorrect(false);
        setShaking(true);
        setShowFeedback(true);
        setTimeout(() => setShaking(false), 400);
      }
    },
    [current, isCorrect]
  );

  useEffect(() => {
    if (isCorrect === true) {
      const timer = setTimeout(() => {
        if (currentIndex < total - 1) {
          setCurrentIndex((i) => i + 1);
          setSelectedIndex(null);
          setIsCorrect(null);
          setShowFeedback(false);
        } else {
          setQuizComplete(true);
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isCorrect, currentIndex, total]);

  if (quizComplete) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="mb-3 flex justify-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: 'rgba(22,163,74,0.15)' }}
          >
            <Award size={28} style={{ color: '#16a34a' }} />
          </div>
        </div>
        <h3 className="mb-1 text-lg font-bold" style={{ color: 'var(--text)' }}>
          Quiz Complete!
        </h3>
        <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
          You scored {score} out of {total}
        </p>
        <button
          onClick={() => onComplete(score)}
          className="rounded-lg px-6 py-2.5 text-sm font-medium transition-all hover:scale-105"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          Complete Lecture
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
          Question {currentIndex + 1} of {total}
        </span>
        <div className="flex gap-1">
          {questions.map((_, i) => (
            <div
              key={i}
              className="h-1.5 w-6 rounded-full"
              style={{
                background: i < currentIndex
                  ? '#16a34a'
                  : i === currentIndex
                  ? 'var(--accent)'
                  : 'var(--border)',
              }}
            />
          ))}
        </div>
      </div>

      <p className="mb-4 text-sm font-medium leading-relaxed" style={{ color: 'var(--text)' }}>
        {current.text}
      </p>

      <div className="space-y-2">
        {current.options.map((opt, oi) => {
          const isSelected = selectedIndex === oi;
          const showAsCorrect = isSelected && isCorrect === true;
          const showAsWrong = isSelected && isCorrect === false;

          let borderColor = 'var(--border)';
          let bgColor = 'var(--bg-elevated)';
          let textColor = 'var(--text-secondary)';

          if (showAsCorrect) {
            borderColor = '#16a34a';
            bgColor = 'rgba(22,163,74,0.1)';
            textColor = '#16a34a';
          } else if (showAsWrong) {
            borderColor = '#dc2626';
            bgColor = 'rgba(220,38,38,0.1)';
            textColor = '#dc2626';
          }

          return (
            <div key={oi}>
              <button
                onClick={() => handleSelect(oi)}
                disabled={isCorrect === true}
                className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm transition-all ${
                  shaking && isSelected ? 'animate-shake' : ''
                }`}
                style={{
                  background: bgColor,
                  border: `1px solid ${borderColor}`,
                  color: textColor,
                  cursor: isCorrect === true ? 'default' : 'pointer',
                }}
              >
                <span
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium"
                  style={{
                    background: showAsCorrect
                      ? '#16a34a'
                      : showAsWrong
                      ? '#dc2626'
                      : 'var(--border)',
                    color: showAsCorrect || showAsWrong ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {showAsCorrect ? (
                    <CheckCircle size={14} />
                  ) : showAsWrong ? (
                    <XCircle size={14} />
                  ) : (
                    String.fromCharCode(65 + oi)
                  )}
                </span>
                <span className="flex-1">{opt.text}</span>
              </button>

              {showAsWrong && showFeedback && opt.feedback && (
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

      {isCorrect === false && showFeedback && selectedIndex !== null && !current.options[selectedIndex]?.feedback && (
        <div
          className="mt-3 ml-9 rounded-md px-3 py-2 text-xs"
          style={{
            background: 'rgba(220,38,38,0.08)',
            color: '#dc2626',
            border: '1px solid rgba(220,38,38,0.2)',
          }}
        >
          Try again! Think about what you learned in the lesson.
        </div>
      )}

      {isCorrect === true && (
        <div className="mt-4 flex justify-end">
          <span className="flex items-center gap-1 text-xs font-medium" style={{ color: '#16a34a' }}>
            Correct! <ArrowRight size={14} />
          </span>
        </div>
      )}
    </div>
  );
}
