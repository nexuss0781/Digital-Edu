import { useEffect, useState } from 'react';
import Editor, { type BeforeMount } from '@monaco-editor/react';
import { initLoader, defineDigitalEduTheme } from '@/lib/monacoSetup';
import { fileKeyToLang, type FileKey } from '@/lib/workshopParser';

interface Props {
  activeFile: FileKey;
  value: string;
  onChange: (value: string) => void;
}

export default function WorkshopEditor({ activeFile, value, onChange }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    initLoader()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div
        className="flex h-full items-center justify-center"
        style={{ background: '#001449', color: '#24438C' }}
      >
        <span className="text-xs font-medium tracking-wider uppercase">Loading editor…</span>
      </div>
    );
  }

  const beforeMount: BeforeMount = (instance) => {
    defineDigitalEduTheme(instance);
  };

  return (
    <Editor
      height="100%"
      language={fileKeyToLang(activeFile)}
      theme="digitaledu-navy"
      value={value}
      beforeMount={beforeMount}
      onChange={(v) => onChange(v ?? '')}
      options={{
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: false },
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        renderLineHighlight: 'all',
        tabSize: 2,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        padding: { top: 12, bottom: 12 },
        fixedOverflowWidgets: true,
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        wordBasedSuggestions: 'off',
        parameterHints: { enabled: false },
        suggest: { showWords: false, showKeywords: false },
      }}
    />
  );
}
