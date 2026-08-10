import { useEffect, useRef, useState } from 'react';

let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null;

async function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(mod => mod.default);
  }
  return mermaidPromise;
}

export function MermaidDiagram({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ref.current || !code) return;
    let cancelled = false;

    (async () => {
      try {
        const mermaid = await getMermaid();
        if (cancelled) return;

        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
        const { svg } = await mermaid.render(id, code);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to render diagram');
      }
    })();

    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <pre className="overflow-x-auto rounded-lg p-3 text-xs" style={{ background: '#001449', color: '#f87171', fontFamily: 'var(--font-mono)' }}>
        <code>{`Mermaid error: ${error}\n\n${code}`}</code>
      </pre>
    );
  }

  return <div ref={ref} className="my-4 flex justify-center" />;
}
