import { useState } from 'react';
import { Copy, Check, Play, RotateCcw } from 'lucide-react';
import type { InteractiveBlock, Rewrite } from '@/types';
import { buildSrcDoc, type Workspace } from '@/lib/workshopParser';

function workspaceFromBlock(lang: string, code: string): Workspace {
  const ws: Workspace = { html: '', css: '', js: '' };
  if (lang === 'css') ws.css = code;
  else if (lang === 'js' || lang === 'javascript') ws.js = code;
  else ws.html = code;
  return ws;
}

function Block({ block, rewrites }: { block: InteractiveBlock; rewrites?: Rewrite[] }) {
  const [code, setCode] = useState(block.code);
  const [copied, setCopied] = useState(false);
  const [runKey, setRunKey] = useState(0);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const srcDoc = buildSrcDoc(workspaceFromBlock(block.lang, code), rewrites);

  return (
    <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--border)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between gap-2 px-4 py-2"
        style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {block.lang}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-opacity"
            style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--accent-light)' }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={() => { setCode(block.code); setRunKey(0); }}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-opacity"
            style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--accent-light)' }}
          >
            <RotateCcw size={12} />
            Reset
          </button>
          <button
            onClick={() => setRunKey((k) => k + 1)}
            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-opacity"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            <Play size={12} />
            Run
          </button>
        </div>
      </div>

      {/* Editable code */}
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        className="w-full resize-y border-0 p-4 font-mono text-xs leading-relaxed outline-none"
        style={{ background: '#001449', color: '#E8F0FE', fontFamily: 'var(--font-mono)', minHeight: '120px' }}
      />

      {/* Output */}
      {runKey > 0 && (
        <iframe
          key={runKey}
          title="interactive-output"
          sandbox="allow-scripts allow-same-origin"
          srcDoc={srcDoc}
          className="h-40 w-full border-0"
          style={{ background: '#ffffff', borderTop: '1px solid var(--border)' }}
        />
      )}
    </div>
  );
}

interface InteractiveCodeBlockProps {
  blocks: InteractiveBlock[];
  rewrites?: Rewrite[];
}

export default function InteractiveCodeBlock({ blocks, rewrites }: InteractiveCodeBlockProps) {
  if (!blocks || blocks.length === 0) return null;

  return (
    <div className="my-4 space-y-3">
      {blocks.map((block, i) => (
        <Block key={i} block={block} rewrites={rewrites} />
      ))}
    </div>
  );
}
