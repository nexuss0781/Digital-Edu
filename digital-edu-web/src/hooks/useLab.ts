import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ContentDetail } from '@/types';
import {
  type FileKey,
  type Workspace,
  emptyWorkspace,
  serializeWorkspace,
  deserializeWorkspace,
  seedFilesToWorkspace,
} from '@/lib/workshopParser';
import { normalizeHints } from '@/lib/labParser';

export interface LabHintState {
  id: string;
  text: string;
  passed: boolean;
  checked: boolean;
}

export function useLab(content: ContentDetail, onComplete?: () => void) {
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [activeFile, setActiveFile] = useState<FileKey>('html');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);
  const [completed, setCompleted] = useState(false);

  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const seedFiles = content.lab?.seed_files || [];
  const rawHints = content.lab?.hints || [];
  const hints = useMemo(() => normalizeHints(rawHints), [rawHints]);

  const [hintStates, setHintStates] = useState<LabHintState[]>([]);

  useEffect(() => {
    setHintStates(hints.map((h) => ({ id: h.id, text: h.text, passed: false, checked: false })));
  }, [hints]);

  const persist = useCallback(
    async (ws: Workspace) => {
      setSaving(true);
      try {
        await api.saveStep(content.id, 1, serializeWorkspace(ws), 'practical');
        setSaved(true);
      } catch {
        setSaved(false);
      } finally {
        setSaving(false);
      }
    },
    [content.id]
  );

  const scheduleSave = useCallback(() => {
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist(workspaceRef.current);
    }, 800);
  }, [persist]);

  const saveNow = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    void persist(workspaceRef.current);
  }, [persist]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .progress(content.id)
      .then((p) => {
        if (cancelled) return;
        const ws = deserializeWorkspace(p.submission);
        if (ws) {
          setWorkspace(ws);
        } else if (p.submission) {
          setWorkspace({ html: p.submission, css: '', js: '' });
          setActiveFile('html');
        } else {
          const seeded = seedFilesToWorkspace(seedFiles);
          if (seeded) setWorkspace(seeded);
        }
        if (p.completed) {
          setCompleted(true);
          setHintStates(hints.map((h) => ({ id: h.id, text: h.text, passed: true, checked: true })));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [content.id, seedFiles, hints]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const updateWorkspace = useCallback(
    (file: FileKey, value: string) => {
      setWorkspace((prev) => ({ ...prev, [file]: value }));
      scheduleSave();
    },
    [scheduleSave]
  );

  const applyHintResult = useCallback((hintId: string, passed: boolean) => {
    setHintStates((prev) =>
      prev.map((h) => (h.id === hintId ? { ...h, passed, checked: true } : h))
    );
  }, []);

  const allPassed = hintStates.length > 0 && hintStates.every((h) => h.checked && h.passed);

  useEffect(() => {
    if (allPassed && !completed) {
      setCompleted(true);
      api
        .completeContent(content.id, { content_type: 'practical', completed: true })
        .then(() => onComplete?.())
        .catch(() => {});
    }
  }, [allPassed, completed, content.id, onComplete]);

  const passedCount = hintStates.filter((h) => h.passed).length;

  return {
    workspace,
    activeFile,
    setActiveFile,
    updateWorkspace,
    hints,
    hintStates,
    loading,
    saving,
    saved,
    completed,
    allPassed,
    passedCount,
    applyHintResult,
    saveNow,
  };
}

export type LabState = ReturnType<typeof useLab>;
