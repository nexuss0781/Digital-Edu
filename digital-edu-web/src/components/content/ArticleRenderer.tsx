import { memo, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import type { Components } from 'react-markdown';
import type { Rewrite } from '@/types';
import { rewriteUrl } from '@/lib/offlineAssets';
import { MermaidDiagram } from './MermaidDiagram';

export function stripFCCMarkers(md: string): string {
  return md
    .replace(/^# --(?:interactive|description|questions)--\s*$/gm, '')
    .replace(/^## --(?:text|answers|video-solution)--\s*$/gm, '')
    .replace(/^### --feedback--\s*$/gm, '')
    .replace(/^:::interactive_editor\s*$/gm, '')
    .replace(/^:::\s*$/gm, '');
}

function isExternalLink(href: string): boolean {
  return /^(https?:|mailto:|tel:)/.test(href);
}

function getHeadingId(children: React.ReactNode): string {
  const text = extractText(children);
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim();
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as React.ReactElement).props.children);
  }
  return '';
}

function Heading({
  level,
  children,
  ...props
}: {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children?: React.ReactNode;
}) {
  const id = getHeadingId(children);
  const Tag = `h${level}` as const;
  return (
    <Tag id={id} {...props}>
      <a href={`#${id}`} className="heading-anchor">
        {children}
      </a>
    </Tag>
  );
}

function ArticleRenderer({ markdown, rewrites }: { markdown: string; rewrites?: Rewrite[] }) {
  const cleanedMarkdown = stripFCCMarkers(markdown);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const headings = ref.current.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('heading-active');
          } else {
            entry.target.classList.remove('heading-active');
          }
        });
      },
      { rootMargin: '-80px 0px -80% 0px', threshold: 0 }
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [cleanedMarkdown]);

  const components: Components = {
    pre({ children }) {
      return (
        <pre className="relative overflow-x-auto rounded-lg p-3 text-xs" style={{ background: '#001449', color: '#E8F0FE', fontFamily: 'var(--font-mono)' }}>
          {children}
        </pre>
      );
    },
    code({ className, children, ...props }) {
      const isBlock = className?.includes('language-');
      if (isBlock) {
        const text = String(children).replace(/\n$/, '');
        const isMermaid = className?.includes('language-mermaid');
        if (isMermaid) {
          return <MermaidDiagram code={text} />;
        }
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }
      return (
        <code className={className} style={{ background: 'rgba(255,255,255,0.08)', padding: '0.15em 0.35em', borderRadius: '4px', fontSize: '0.875em' }} {...props}>
          {children}
        </code>
      );
    },
    img({ src, alt }) {
      return <img src={rewriteUrl(src || '', rewrites)} alt={alt || ''} loading="lazy" className="rounded-lg" />;
    },
    a({ href, children, ...props }) {
      const external = href ? isExternalLink(href) : false;
      return (
        <a
          href={href}
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          {...props}
        >
          {children}
        </a>
      );
    },
    h1: (props) => <Heading level={1} {...props} />,
    h2: (props) => <Heading level={2} {...props} />,
    h3: (props) => <Heading level={3} {...props} />,
    h4: (props) => <Heading level={4} {...props} />,
    h5: (props) => <Heading level={5} {...props} />,
    h6: (props) => <Heading level={6} {...props} />,
  };

  return (
    <div ref={ref} className="prose-custom" style={{ color: 'var(--text)' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkFrontmatter]}
        rehypePlugins={[rehypeSlug, rehypeAutolinkHeadings]}
        components={components}
      >
        {cleanedMarkdown}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ArticleRenderer);
