import { FileText } from 'lucide-react';

interface OverviewPanelProps {
  html: string;
}

export default function OverviewPanel({ html }: OverviewPanelProps) {
  if (!html || html.trim().length === 0) {
    return (
      <div
        style={{
          padding: 48,
          textAlign: 'center',
          color: 'var(--text-muted)',
        }}
      >
        <FileText size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
        <p style={{ fontSize: 14 }}>No overview available for this course</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div
        className="course-overview"
        style={{
          fontSize: 15,
          lineHeight: 1.7,
          color: 'var(--text-secondary)',
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <style>{`
        .course-overview h1 { font-size: 24px; font-weight: 700; color: var(--text); margin: 28px 0 12px; font-family: var(--font-display); }
        .course-overview h2 { font-size: 20px; font-weight: 600; color: var(--text); margin: 24px 0 10px; }
        .course-overview h3 { font-size: 17px; font-weight: 600; color: var(--text); margin: 20px 0 8px; }
        .course-overview p { margin: 0 0 16px; }
        .course-overview ul, .course-overview ol { margin: 0 0 16px; padding-left: 24px; }
        .course-overview li { margin-bottom: 6px; }
        .course-overview code {
          font-family: var(--font-mono);
          font-size: 13px;
          background: var(--bg-elevated);
          padding: 2px 6px;
          border-radius: 4px;
          color: var(--accent);
        }
        .course-overview pre {
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 16px;
          overflow-x: auto;
          margin: 0 0 16px;
        }
        .course-overview pre code { background: none; padding: 0; color: var(--text-secondary); }
        .course-overview blockquote {
          border-left: 3px solid var(--accent);
          padding: 12px 16px;
          margin: 0 0 16px;
          background: var(--accent-glow);
          border-radius: 0 8px 8px 0;
          color: var(--text-secondary);
        }
        .course-overview a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
        .course-overview strong { color: var(--text); font-weight: 600; }
        .course-overview img { max-width: 100%; border-radius: 10px; margin: 12px 0; }
        .course-overview table { width: 100%; border-collapse: collapse; margin: 0 0 16px; }
        .course-overview th, .course-overview td {
          padding: 10px 14px;
          text-align: left;
          border-bottom: 1px solid var(--border);
          font-size: 14px;
        }
        .course-overview th { font-weight: 600; color: var(--text); background: var(--bg-elevated); }
      `}</style>
    </div>
  );
}
