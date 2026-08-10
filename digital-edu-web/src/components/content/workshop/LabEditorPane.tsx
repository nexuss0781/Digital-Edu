import { memo } from 'react';
import { BadgeCheck, CloudOff, CloudUpload, Loader2 } from 'lucide-react';
import type { LabState } from '@/hooks/useLab';
import WorkshopEditor from './WorkshopEditor';
import { FileTabLogo } from './FileTabLogo';

interface Props {
  state: LabState;
}

const FILE_TABS: { key: 'html' | 'css' | 'js'; label: string }[] = [
  { key: 'html', label: 'index.html' },
  { key: 'css', label: 'styles.css' },
  { key: 'js', label: 'script.js' },
];

function LabEditorPaneInner({ state }: Props) {
  const { workspace, activeFile, setActiveFile, updateWorkspace, saving, saved, allPassed } = state;

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg-card)' }}>
      <div
        className="flex items-center gap-1 border-b px-2"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-hover)' }}
      >
        {FILE_TABS.map((tab) => {
          const isActive = tab.key === activeFile;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveFile(tab.key)}
              className="flex items-center gap-1.5 rounded-t-md px-3 py-2 text-xs font-medium transition-colors"
              style={{
                background: isActive ? 'var(--bg)' : 'transparent',
                color: isActive ? 'var(--text)' : 'var(--text-secondary)',
                borderTop: isActive ? '2px solid var(--color-gold)' : '2px solid transparent',
              }}
            >
              <FileTabLogo name={tab.key} size={13} />
              {tab.label}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2 pr-2">
          {allPassed && (
            <span
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ background: 'rgba(34,197,94,0.14)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.35)' }}
            >
              <BadgeCheck size={12} />
              Lab complete
            </span>
          )}
          <span style={{ color: saved ? 'var(--accent)' : 'var(--color-gold)' }}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <CloudUpload size={13} /> : <CloudOff size={13} />}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <WorkshopEditor
          activeFile={activeFile}
          value={workspace[activeFile]}
          onChange={(v) => updateWorkspace(activeFile, v)}
        />
      </div>
    </div>
  );
}

export const LabEditorPane = memo(LabEditorPaneInner);
