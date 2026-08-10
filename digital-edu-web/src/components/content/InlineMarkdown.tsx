import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

export default function InlineMarkdown({ text }: { text: string }) {
  const components: Components = {
    p({ children }) {
      return <span>{children}</span>;
    },
    strong({ children }) {
      return <strong style={{ color: 'inherit', fontWeight: 700 }}>{children}</strong>;
    },
    em({ children }) {
      return <em style={{ color: 'inherit' }}>{children}</em>;
    },
    code({ children }) {
      return (
        <code
          style={{
            background: 'rgba(23,249,255,0.12)',
            color: '#7FE8FF',
            padding: '0.15em 0.35em',
            borderRadius: '4px',
            fontSize: '0.9em',
          }}
        >
          {children}
        </code>
      );
    },
    a({ href, children }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#7FD1FF', textDecoration: 'underline' }}
        >
          {children}
        </a>
      );
    },
    ul({ children }) {
      return <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1rem' }}>{children}</ul>;
    },
    ol({ children }) {
      return <ol style={{ margin: '0.25rem 0 0', paddingLeft: '1rem' }}>{children}</ol>;
    },
    li({ children }) {
      return <li style={{ margin: '0.15rem 0' }}>{children}</li>;
    },
  };

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
}
