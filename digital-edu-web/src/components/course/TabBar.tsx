import { BookOpen, Info, FolderOpen, MessageSquare } from 'lucide-react';

export type TabId = 'curriculum' | 'overview' | 'references' | 'discussion';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'curriculum', label: 'Curriculum', icon: <BookOpen size={16} /> },
  { id: 'overview', label: 'Overview', icon: <Info size={16} /> },
  { id: 'references', label: 'References', icon: <FolderOpen size={16} /> },
  { id: 'discussion', label: 'Discussion', icon: <MessageSquare size={16} /> },
];

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export default function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: 4,
        borderRadius: 16,
        backgroundColor: 'var(--bg-elevated)',
        marginBottom: 24,
        overflowX: 'auto',
      }}
    >
      {TABS.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 20px',
              borderRadius: 12,
              border: 'none',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s',
              backgroundColor: active ? 'var(--bg-card)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-muted)',
              position: 'relative',
              whiteSpace: 'nowrap',
              boxShadow: active ? 'var(--shadow-sm)' : 'none',
            }}
          >
            {tab.icon}
            {tab.label}
            {active && (
              <div
                style={{
                  position: 'absolute',
                  bottom: -4,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 20,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: 'var(--accent)',
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
