import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import type { ContentDetail, LectureData } from '@/types';
import ArticleRenderer from './ArticleRenderer';
import InteractiveCodeBlock from './InteractiveCodeBlock';
import NoteQuiz from './NoteQuiz';

interface LectureContentProps {
  content: ContentDetail;
  onComplete?: () => void;
}

export default function LectureContent({ content, onComplete }: LectureContentProps) {
  const lectureData = content.lecture_data;
  const alreadyCompleted = Boolean(content.completed);
  const [quizFinished, setQuizFinished] = useState(false);
  const [retaking, setRetaking] = useState(false);

  const handleQuizComplete = useCallback(
    async (score: number) => {
      setQuizFinished(true);
      try {
        await api.completeContent(content.id, {
          content_type: 'lecture',
          score,
          passed: true,
        });
        onComplete?.();
      } catch {
        // Progress save failed silently
      }
    },
    [content.id, onComplete]
  );

  if (!lectureData) {
    return (
      <ArticleRenderer markdown={content.body} rewrites={content.rewrites} />
    );
  }

  const showQuiz = !quizFinished && (!alreadyCompleted || retaking);

  return (
    <div className="space-y-6">
      {/* Content section */}
      {lectureData.content_section && (
        <ArticleRenderer markdown={lectureData.content_section} rewrites={content.rewrites} />
      )}

      {/* Interactive code blocks */}
      {lectureData.interactive_blocks.length > 0 && (
        <InteractiveCodeBlock blocks={lectureData.interactive_blocks} rewrites={content.rewrites} />
      )}

      {/* Already completed banner */}
      {alreadyCompleted && !quizFinished && !retaking && (
        <div
          className="rounded-xl p-4 text-center text-sm"
          style={{
            background: 'rgba(22,163,74,0.1)',
            border: '1px solid rgba(22,163,74,0.3)',
            color: 'var(--success, #16a34a)',
          }}
        >
          Lecture completed! You can now proceed to the next lesson.
          <button
            onClick={() => setRetaking(true)}
            className="ml-3 rounded-lg px-3 py-1 text-xs font-medium transition-all hover:scale-105"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Retake quiz
          </button>
        </div>
      )}

      {/* Quiz section */}
      {showQuiz && lectureData.questions.length > 0 && (
        <div className="mt-8">
          <div className="mb-4 flex items-center gap-2">
            <div
              className="h-px flex-1"
              style={{ background: 'var(--border)' }}
            />
            <span
              className="text-xs font-medium uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}
            >
              Knowledge Check
            </span>
            <div
              className="h-px flex-1"
              style={{ background: 'var(--border)' }}
            />
          </div>
          <NoteQuiz
            questions={lectureData.questions}
            onComplete={handleQuizComplete}
          />
        </div>
      )}

      {/* Quiz complete message */}
      {quizFinished && (
        <div
          className="rounded-xl p-4 text-center text-sm"
          style={{
            background: 'rgba(22,163,74,0.1)',
            border: '1px solid rgba(22,163,74,0.3)',
            color: 'var(--success, #16a34a)',
          }}
        >
          Lecture completed! You can now proceed to the next lesson.
        </div>
      )}
    </div>
  );
}
