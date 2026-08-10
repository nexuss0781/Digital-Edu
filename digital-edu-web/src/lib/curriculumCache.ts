import { api } from './api';
import type { CurriculumNode } from '@/types';

interface CacheEntry {
  version: string;
  tree: CurriculumNode;
  checkedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CHECK_INTERVAL = 10_000;

interface CurriculumResponse extends CurriculumNode {
  version?: string;
}

async function fetchCourse(courseId: string): Promise<CacheEntry> {
  const data = (await api.curriculum(courseId)) as CurriculumResponse;
  return {
    version: data.version ?? '',
    tree: data,
    checkedAt: Date.now(),
  };
}

/**
 * Returns the cached course tree when the structure hasn't changed, and
 * transparently refetches when it has. The `version` comes from the cheap
 * `/api/v1/meta/version` endpoint, so admin edits (hiding items, locks,
 * renames) propagate without a full page reload.
 */
export async function getCurriculum(courseId: string): Promise<CurriculumNode> {
  const entry = cache.get(courseId);
  if (!entry) {
    const fresh = await fetchCourse(courseId);
    cache.set(courseId, fresh);
    return fresh.tree;
  }

  if (Date.now() - entry.checkedAt >= CHECK_INTERVAL) {
    try {
      const { version } = await api.structureVersion();
      if (version !== entry.version) {
        const fresh = await fetchCourse(courseId);
        cache.set(courseId, fresh);
        return fresh.tree;
      }
      entry.checkedAt = Date.now();
    } catch {
      // network hiccup — fall through to the cached tree
    }
  }
  return entry.tree;
}

export function invalidateCurriculum(courseId?: string) {
  if (courseId) {
    cache.delete(courseId);
  } else {
    cache.clear();
  }
}
