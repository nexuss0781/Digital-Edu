import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { getCurriculum } from '@/lib/curriculumCache';
import { CourseDetail, CurriculumNode, Reference } from '@/types';
import CourseHero from '@/components/course/CourseHero';
import TabBar, { TabId } from '@/components/course/TabBar';
import CurriculumAccordion from '@/components/course/CurriculumAccordion';
import OverviewPanel from '@/components/course/OverviewPanel';
import ReferencesPanel from '@/components/course/ReferencesPanel';
import { MessageSquare } from 'lucide-react';

function DetailSkeleton() {
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 60px' }}>
      {/* Hero skeleton */}
      <div
        className="skeleton-shimmer"
        style={{ width: '100%', height: 400, borderRadius: 20, marginBottom: 24 }}
      />
      {/* Tab skeleton */}
      <div
        className="skeleton-shimmer"
        style={{ width: '100%', height: 48, borderRadius: 16, marginBottom: 24 }}
      />
      {/* Content skeleton */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="skeleton-shimmer"
            style={{
              width: '100%',
              height: 44,
              borderRadius: 10,
              animationDelay: `${i * 80}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function getFirstLeaf(node: CurriculumNode): CurriculumNode | null {
  if (!node.children || node.children.length === 0) return node;
  for (const child of node.children) {
    const leaf = getFirstLeaf(child);
    if (leaf && leaf.id) return leaf;
  }
  return null;
}

function findNextContent(curriculum: CurriculumNode | null): string | undefined {
  if (!curriculum) return undefined;
  const nodes: CurriculumNode[] = curriculum.children || [curriculum];
  // priority: first unlocked non-leaf → first unlocked leaf → first leaf
  for (const node of nodes) {
    const allLeaves: CurriculumNode[] = [];
    const collectLeaves = (n: CurriculumNode) => {
      if (!n.children || n.children.length === 0) {
        if (n.id) allLeaves.push(n);
      } else {
        n.children.forEach(collectLeaves);
      }
    };
    collectLeaves(node);
    const unlocked = allLeaves.filter((l) => !l.locked);
    const notCompleted = unlocked.filter((l) => !l.completed);
    if (notCompleted.length > 0) return notCompleted[0].id;
    if (unlocked.length > 0) return unlocked[0].id;
    if (allLeaves.length > 0) return allLeaves[0].id;
  }
  const leaf = getFirstLeaf(curriculum);
  return leaf?.id;
}

export default function CourseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const cid = id ?? '';

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [curriculum, setCurriculum] = useState<CurriculumNode | null>(null);
  const [overviewHtml, setOverviewHtml] = useState('');
  const [references, setReferences] = useState<Reference[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('curriculum');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');

    Promise.all([
      api.courseDetail(cid),
      getCurriculum(cid),
      api.overview(cid).catch(() => ({ html: '' })),
      api.references(cid).catch(() => ({ references: [] })),
    ])
      .then(([courseData, curriculumData, overviewData, refData]) => {
        setCourse(courseData);
        setCurriculum(curriculumData);
        setOverviewHtml(overviewData.html || '');
        setReferences(refData.references || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [cid]);

  if (loading) return <DetailSkeleton />;

  if (error || !course) {
    return (
      <div
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '60px 20px',
          textAlign: 'center',
          color: 'var(--danger)',
          fontSize: 15,
        }}
      >
        {error || 'Course not found'}
      </div>
    );
  }

  const curriculumNodes = curriculum?.children || (curriculum ? [curriculum] : []);

  return (
    <div
      className="animate-fade-in"
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '24px 20px 60px',
      }}
    >
      <CourseHero course={course} nextContentId={findNextContent(curriculum)} />

      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab panels */}
      {activeTab === 'curriculum' && (
        <CurriculumAccordion nodes={curriculumNodes} courseId={cid} />
      )}

      {activeTab === 'overview' && <OverviewPanel html={overviewHtml} />}

      {activeTab === 'references' && <ReferencesPanel references={references} />}

      {activeTab === 'discussion' && (
        <div
          className="animate-fade-in"
          style={{
            padding: 48,
            textAlign: 'center',
            color: 'var(--text-muted)',
          }}
        >
          <MessageSquare size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
          <p style={{ fontSize: 15 }}>Discussion coming soon</p>
        </div>
      )}
    </div>
  );
}
