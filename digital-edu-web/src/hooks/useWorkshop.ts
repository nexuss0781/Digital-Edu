import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import type { ContentDetail } from '@/types';
import {
  type FileKey,
  type Workspace,
  emptyWorkspace,
  serializeWorkspace,
  deserializeWorkspace,
  seedFilesToWorkspace,
  isWorkspaceEmpty,
} from '@/lib/workshopParser';
import type { CheckResult } from '@/lib/workshopChecks';

export function useWorkshop(content: ContentDetail, onComplete?: () => void) {
  const [searchParams] = useSearchParams();
  const steps = useMemo(
    () =>
      (content.assessments?.[0]?.steps || [])
        .slice()
        .sort((a, b) => a.step - b.step),
    [content]
  );
  const totalSteps = content.step_count || steps.length;

  const jumpParam = searchParams.get('step');
  const jumpIndex = useMemo(() => {
    const n = jumpParam ? Number.parseInt(jumpParam, 10) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= totalSteps) return n - 1;
    return null;
  }, [jumpParam, totalSteps]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [activeFile, setActiveFile] = useState<FileKey>('html');
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);
  const [checkResults, setCheckResults] = useState<CheckResult[] | null>(null);

  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const completedCount = completedSteps.size;
  const allDone = completedCount >= totalSteps;
  const progressPct = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;

  const completedCountRef = useRef(completedCount);
  completedCountRef.current = completedCount;
  const completedStepsRef = useRef(completedSteps);
  completedStepsRef.current = completedSteps;

  const persist = useCallback(
    async (stepIndex: number, ws: Workspace) => {
      setSaving(true);
      try {
        await api.saveStep(content.id, stepIndex + 1, serializeWorkspace(ws));
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
      void persist(workspaceRef.current ? currentIndexRef.current : 0, workspaceRef.current);
    }, 800);
  }, [persist]);

  const saveNow = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    void persist(currentIndexRef.current, workspaceRef.current);
  }, [persist]);

  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  const applySeedIfEmpty = useCallback((index: number) => {
    const step = steps[index];
    if (!step) return;
    setWorkspace((prev) => {
      if (!isWorkspaceEmpty(prev)) return prev;
      const seeded = seedFilesToWorkspace(step.seed_files);
      return seeded || prev;
    });
  }, [steps]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .progress(content.id)
      .then((p) => {
        if (cancelled) return;
        const ws = deserializeWorkspace(p.submission);
        let targetIndex = 0;
        if (p.step_index > 0 && p.step_index <= totalSteps) {
          targetIndex = p.step_index - 1;
          setCurrentIndex(targetIndex);
        }
        if (p.completed) {
          setCompletedSteps(new Set(Array.from({ length: totalSteps }, (_, i) => i)));
        } else if (p.step_index > 0) {
          setCompletedSteps(new Set(Array.from({ length: Math.min(p.step_index, totalSteps) }, (_, i) => i)));
        }
        if (jumpIndex !== null) {
          const unlockedBound = p.completed ? totalSteps : Math.min(p.step_index || 0, totalSteps);
          if (jumpIndex <= unlockedBound) {
            targetIndex = jumpIndex;
            setCurrentIndex(jumpIndex);
          }
        }
        if (ws) {
          setWorkspace(ws);
        } else if (p.submission) {
          setWorkspace({ html: p.submission, css: '', js: '' });
          setActiveFile('html');
        } else {
          applySeedIfEmpty(targetIndex);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [content.id, totalSteps, applySeedIfEmpty]);

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

  const isStepUnlocked = useCallback(
    (index: number) => index >= 0 && index < totalSteps && index <= completedCountRef.current,
    [totalSteps]
  );

  const completeStep = useCallback(
    (index: number) => {
      if (completedStepsRef.current.has(index)) {
        return;
      }
      setCompletedSteps((prev) => {
        const next = new Set(prev);
        next.add(index);
        return next;
      });
      void persist(index, workspaceRef.current);
    },
    [persist]
  );

  const completeStepAndAdvance = useCallback(() => {
    const index = currentIndexRef.current;
    completeStep(index);
    setCheckResults(null);
    if (index < totalSteps - 1) {
      setCurrentIndex(index + 1);
      applySeedIfEmpty(index + 1);
    }
  }, [completeStep, totalSteps, applySeedIfEmpty]);

  const applyCheckResults = useCallback(
    (results: CheckResult[]) => {
      setCheckResults(results);
      const passed = results.length > 0 && results.every((r) => r.passed);
      if (passed) {
        completeStep(currentIndexRef.current);
      }
    },
    [completeStep]
  );

  useEffect(() => {
    const step = steps[currentIndex];
    if (
      step &&
      (!step.hints || step.hints.length === 0) &&
      !completedStepsRef.current.has(currentIndex)
    ) {
      completeStepAndAdvance();
    }
  }, [currentIndex, steps, completeStepAndAdvance]);

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= totalSteps) return;
      if (!isStepUnlocked(index)) return;
      if (index === currentIndexRef.current) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void persist(currentIndexRef.current, workspaceRef.current);
      setCurrentIndex(index);
      setSaved(true);
      setCheckResults(null);
      applySeedIfEmpty(index);
    },
    [persist, totalSteps, isStepUnlocked, applySeedIfEmpty]
  );

  const goNext = useCallback(() => {
    if (completedStepsRef.current.has(currentIndexRef.current)) {
      goTo(currentIndexRef.current + 1);
    }
  }, [goTo]);

  const goPrev = useCallback(() => {
    goTo(currentIndexRef.current - 1);
  }, [goTo]);

  useEffect(() => {
    if (allDone) {
      api
        .completeContent(content.id, { content_type: 'workshop', completed: true })
        .then(() => onComplete?.())
        .catch(() => {});
    }
  }, [allDone, content.id, onComplete]);

  const activeStep = useMemo(
    () => steps[currentIndex] || null,
    [steps, currentIndex]
  );

  return {
    steps,
    totalSteps,
    currentIndex,
    currentStep: activeStep,
    workspace,
    activeFile,
    setActiveFile,
    updateWorkspace,
    completedSteps,
    completedCount,
    allDone,
    progressPct,
    loading,
    saving,
    saved,
    checkResults,
    applyCheckResults,
    isStepUnlocked,
    goTo,
    goNext,
    goPrev,
    saveNow,
  };
}

export type WorkshopState = ReturnType<typeof useWorkshop>;
