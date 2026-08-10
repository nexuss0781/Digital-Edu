import { memo, useState } from 'react';
import { Monitor, RotateCw, ExternalLink } from 'lucide-react';
import type { Workspace } from '@/lib/workshopParser';
import { buildSrcDoc } from '@/lib/workshopParser';
import type { Rewrite } from '@/types';

interface Props {
  workspace: Workspace;
  rewrites?: Rewrite[];
}

function LiveViewerInner({ workspace, rewrites }: Props) {
  const [nonce, setNonce] = useState(0);
  const srcDoc = buildSrcDoc(workspace, rewrites);

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg)' }}>
      <div className="flex items-center gap-1.5 border-b px-3 py-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-hover)' }}>
        <Monitor size={14} style={{ color: 'var(--color-cyan)' }} />
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          Live preview
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setNonce((n) => n + 1)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-[var(--accent-glow)]"
            style={{ color: 'var(--text-secondary)' }}
            title="Reload preview"
          >
            <RotateCw size={13} />
            Reload
          </button>
          <button
            className="hidden items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-[var(--accent-glow)] sm:flex"
            style={{ color: 'var(--text-secondary)' }}
            onClick={() => {
              const win = window.open();
              if (win) {
                win.document.open();
                win.document.write(srcDoc);
                win.document.close();
              }
            }}
          >
            <ExternalLink size={13} />
            Open
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1" style={{ background: '#ffffff' }}>
        <iframe
          key={nonce}
          srcDoc={srcDoc}
          title="Live preview"
          sandbox="allow-scripts allow-modals"
          className="h-full w-full border-0"
        />
      </div>
    </div>
  );
}

export const LiveViewer = memo(LiveViewerInner);
