import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import {
  Upload, Eye, Edit3, ChevronRight, ChevronDown,
  Lock, Unlock, EyeOff, X, FileText,
  FolderOpen, Hash, AlertCircle,
} from 'lucide-react';
import { AdminContentItem } from '@/types';
import {
  tokens, page, PageHeader, Field, Tag, IconBtn,
  primaryBtn, secondaryBtn, inputStyle, selectStyle,
  sectionCard, sectionTitle,
  EmptyState,
} from '@/styles/admin';

interface StructureEntry {
  hidden?: boolean;
  lock_type?: string;
  lock_value?: string;
  title?: string;
  prerequisites?: string[];
}

const typeIcon: Record<string, typeof FileText> = {
  category: FolderOpen,
  workshop: Hash,
  assessment: AlertCircle,
};

export default function AdminContentPage() {
  const { toast } = useToast();

  const [tree, setTree] = useState<AdminContentItem[]>([]);
  const [structure, setStructure] = useState<Record<string, StructureEntry>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    title: '', lock_type: '', lock_value: '', prerequisites: '',
    hidden: 'false', body: '',
  });
  const [lockDefault, setLockDefault] = useState<'pass' | 'date' | 'manual'>('pass');
  const [showLockDropdown, setShowLockDropdown] = useState(false);
  const [selectAll, setSelectAll] = useState(false);

  useEffect(() => {
    Promise.all([
      adminApi.structure() as Promise<Record<string, StructureEntry>>,
      adminApi.courseTree().catch(() => []) as Promise<AdminContentItem[]>,
    ]).then(([struct, treeData]) => {
      setStructure(struct);
      if (treeData.length > 0) setTree(treeData);
      else loadTreeFromDom();
      setLoading(false);
    }).catch(() => {
      loadTreeFromDom();
      setLoading(false);
    });
  }, []);

  const loadTreeFromDom = async () => {
    const struct = await adminApi.structure();
    setStructure(struct);
    setTree([]);
    const captured = await adminApi.capture();
    const items = Object.entries(captured).map(([id, data]: [string, any]) => ({
      id,
      title: data.title || id,
      type: data.type || 'unknown',
      depth: data.depth || 0,
    }));
    setTree([{
      id: 'root', title: 'Content Tree', type: 'category', depth: 0,
      children: items.slice(0, 50),
    } as AdminContentItem]);
  };

  const getAllIds = (items: AdminContentItem[]): string[] => {
    const ids: string[] = [];
    for (const item of items) {
      ids.push(item.id);
      if (item.children) ids.push(...getAllIds(item.children));
    }
    return ids;
  };

  const collectDescendants = (items: AdminContentItem[], targetId: string): string[] => {
    for (const item of items) {
      if (item.id === targetId) {
        return item.children ? getAllIds(item.children) : [];
      }
      if (item.children) {
        const found = collectDescendants(item.children, targetId);
        if (found.length > 0 || item.children.some(c => c.id === targetId)) return found;
      }
    }
    return [];
  };

  const toggleSelect = (id: string) => {
    const descendants = collectDescendants(tree, id);
    setSelected(prev => {
      const next = new Set(prev);
      const parentSelected = next.has(id);
      const allChildrenSelected = descendants.every(d => next.has(d));

      if (!parentSelected && !allChildrenSelected) {
        // cycle 0 → 1: select parent + all children
        next.add(id);
        descendants.forEach(d => next.add(d));
      } else if (parentSelected && allChildrenSelected) {
        // cycle 1 → 2: deselect parent, keep children
        next.delete(id);
      } else if (!parentSelected && allChildrenSelected) {
        // cycle 2 → 3: select parent, deselect children
        next.add(id);
        descendants.forEach(d => next.delete(d));
      } else {
        // cycle 3 → 0: deselect parent + children
        next.delete(id);
        descendants.forEach(d => next.delete(d));
      }

      setSelectAll(false);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelected(new Set());
      setSelectAll(false);
    } else {
      const all = getAllIds(tree);
      setSelected(new Set(all));
      setSelectAll(true);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const batchAction = async (key: string, value: any) => {
    const ids = Array.from(selected);
    if (ids.length === 0) { toast('Select items first'); return; }
    const updates: Record<string, any> = { [key]: value };
    if (key === 'lock_type' && value === 'date') {
      const input = prompt('Enter date/time value (DD/MM/YY or X days/weeks/months/years):');
      if (!input) return;
      updates.lock_value = input;
    }
    try {
      await adminApi.batchUpdate(ids, updates);
      toast(`Updated ${ids.length} items`);
      setSelected(new Set());
      setSelectAll(false);
      setStructure(prev => {
        const next = { ...prev };
        ids.forEach(id => { next[id] = { ...(next[id] || {}), ...updates }; });
        return next;
      });
    } catch (err: any) {
      toast(err.message || 'Failed', true);
    }
  };

  const handleCapture = async () => {
    try {
      const data = await adminApi.capture();
      toast(`Captured ${Object.keys(data).length} items`);
    } catch (err: any) {
      toast(err.message || 'Failed', true);
    }
  };

  const openEdit = async (id: string) => {
    try {
      const data = await adminApi.contentPreview(id);
      setEditItem(data);
      setEditForm({
        title: data.title || '',
        lock_type: '',
        lock_value: '',
        prerequisites: '',
        hidden: 'false',
        body: data.body || '',
      });
    } catch {
      toast('Content not found', true);
    }
  };

  const closeEdit = () => setEditItem(null);

  const saveEdit = async () => {
    if (!editItem) return;
    const updates: Record<string, any> = {
      title: editForm.title,
      hidden: editForm.hidden === 'true',
      lock_type: editForm.lock_type || null,
      lock_value: editForm.lock_type === 'date' ? editForm.lock_value : null,
      prerequisites: editForm.prerequisites
        ? editForm.prerequisites.split(',').map(s => s.trim()).filter(Boolean)
        : [],
    };
    try {
      await adminApi.updateItem(editItem.id, updates);
      if (editForm.body) await adminApi.saveContent(editItem.id, editForm.body);
      toast('Saved!');
      closeEdit();
    } catch (err: any) {
      toast(err.message || 'Failed to save', true);
    }
  };

  const getStatusTags = (cfg: StructureEntry) => {
    const tags: { label: string; variant: 'success' | 'warning' | 'danger' | 'info' }[] = [];
    if (cfg.hidden) tags.push({ label: 'Hidden', variant: 'danger' });
    if (cfg.lock_type) {
      const v = cfg.lock_type === 'pass' ? 'info' : cfg.lock_type === 'date' ? 'warning' : 'danger';
      tags.push({ label: cfg.lock_type, variant: v });
    }
    return tags;
  };

  const isAllSelected = (items: AdminContentItem[]): boolean => {
    const all = getAllIds(items);
    return all.length > 0 && all.every(id => selected.has(id));
  };

  const renderItem = (item: AdminContentItem, depth: number): React.ReactNode => {
    const cfg = structure[item.id] || {};
    const isHidden = cfg.hidden || false;
    const isLocked = !!cfg.lock_type;
    const isSelected = selected.has(item.id);
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expanded.has(item.id);
    const TypeIcon = typeIcon[item.type] || FileText;
    const statusTags = getStatusTags(cfg);

    return (
      <div key={item.id}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: depth === 0 ? '13px 16px' : '9px 14px',
            background: isSelected ? 'var(--accent-glow)' : 'var(--bg-card)',
            border: `1px solid ${
              isHidden ? 'rgba(220,38,38,0.2)' :
              isLocked ? 'rgba(23,249,255,0.25)' :
              isSelected ? 'var(--accent)' :
              'var(--border)'
            }`,
            borderRadius: tokens.md,
            opacity: isHidden ? 0.5 : isLocked ? 0.8 : 1,
            marginLeft: depth * 22,
            marginBottom: 5,
            transition: 'all 0.12s',
            position: 'relative',
          }}
          onMouseEnter={e => {
            if (!isSelected) e.currentTarget.style.borderColor = 'var(--accent)';
          }}
          onMouseLeave={e => {
            if (!isSelected) {
              e.currentTarget.style.borderColor = isHidden
                ? 'rgba(220,38,38,0.2)'
                : isLocked
                ? 'rgba(23,249,255,0.25)'
                : 'var(--border)';
            }
          }}
        >
          {hasChildren && (
            <button
              onClick={() => toggleExpand(item.id)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 2, color: 'var(--text-muted)',
                display: 'flex', alignItems: 'center',
                transition: 'transform 0.15s',
                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            >
              <ChevronRight size={14} />
            </button>
          )}
          {!hasChildren && <div style={{ width: 18 }} />}

          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelect(item.id)}
            style={{
              width: 16, height: 16, cursor: 'pointer',
              accentColor: 'var(--accent)',
              flexShrink: 0,
            }}
          />

          <div style={{
            width: 28, height: 28, borderRadius: tokens.sm,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: depth === 0 ? 'var(--accent-glow-strong)' : 'var(--bg-elevated)',
            color: depth === 0 ? 'var(--accent)' : 'var(--text-muted)',
            flexShrink: 0,
          }}>
            <TypeIcon size={depth === 0 ? 15 : 13} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontWeight: depth === 0 ? 600 : 500,
              fontSize: depth === 0 ? tokens.size.md : tokens.size.base,
              color: 'var(--text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontFamily: tokens.font.ui,
            }}>
              {item.title || item.name || item.id}
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              marginTop: 3, flexWrap: 'wrap',
            }}>
              <span style={{
                fontSize: tokens.size.xs,
                fontFamily: tokens.font.mono,
                color: 'var(--text-muted)',
              }}>
                {item.id}
              </span>
              <Tag>{item.type}</Tag>
              {statusTags.map(t => (
                <Tag key={t.label} variant={t.variant}>{t.label}</Tag>
              ))}
              {cfg.prerequisites && cfg.prerequisites.length > 0 && (
                <span style={{
                  fontSize: tokens.size.xs, color: 'var(--text-muted)',
                  fontFamily: tokens.font.ui,
                }}>
                  Prereqs: {cfg.prerequisites.length}
                </span>
              )}
            </div>
          </div>

          <div style={{
            display: 'flex', gap: 4, flexShrink: 0,
            opacity: 0, transition: 'opacity 0.12s',
          }}
            className="admin-row-actions"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0'; }}
          >
            <IconBtn onClick={() => openEdit(item.id)} title="Edit">
              <Edit3 size={12} /> Edit
            </IconBtn>
            <IconBtn
              onClick={() => window.open('/courses/' + item.id, '_blank')}
              title="Preview"
            >
              <Eye size={12} /> View
            </IconBtn>
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div style={{ position: 'relative' }}>
            {/* tree connection line */}
            <div style={{
              position: 'absolute',
              left: depth * 22 + 9,
              top: 0,
              bottom: 5,
              width: 1,
              background: 'var(--border)',
            }} />
            {item.children!.map((child, idx) => (
              <div key={child.id} style={{ position: 'relative' }}>
                {/* branch connector */}
                <div style={{
                  position: 'absolute',
                  left: depth * 22 + 9,
                  top: '50%',
                  width: 14,
                  height: 1,
                  background: 'var(--border)',
                }} />
                {renderItem(child, depth + 1)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={page}>
      <PageHeader
        title="Content Manager"
        subtitle="Browse, select, and manage your content hierarchy"
      />

      {/* Batch action bar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8,
        padding: '14px 18px', marginBottom: 20,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: tokens.xl,
        alignItems: 'center',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginRight: 8,
        }}>
          <input
            type="checkbox"
            checked={selectAll || isAllSelected(tree)}
            onChange={toggleSelectAll}
            style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }}
          />
          <span style={{
            fontSize: tokens.size.xs,
            fontWeight: 600,
            color: 'var(--text-muted)',
            fontFamily: tokens.font.ui,
          }}>
            {selected.size} selected
          </span>
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

        {selected.size > 0 && (
          (() => {
            const hasHidden = Array.from(selected).some(id => structure[id]?.hidden);
            const hasLocked = Array.from(selected).some(id => !!structure[id]?.lock_type);
            return (
              <>
                {hasHidden ? (
                  <IconBtn onClick={() => batchAction('hidden', false)}>
                    <Eye size={12} /> Unhide
                  </IconBtn>
                ) : (
                  <IconBtn onClick={() => batchAction('hidden', true)}>
                    <EyeOff size={12} /> Hide
                  </IconBtn>
                )}
                {hasLocked ? (
                  <IconBtn onClick={() => batchAction('lock_type', null)}>
                    <Unlock size={12} /> Unlock
                  </IconBtn>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <div style={{ display: 'flex' }}>
                      <button
                        onClick={() => batchAction('lock_type', lockDefault)}
                        style={{
                          padding: '5px 10px', borderRadius: `${tokens.sm}px 0 0 ${tokens.sm}px`,
                          borderRight: 'none',
                          border: '1px solid var(--border)',
                          background: 'transparent',
                          color: 'var(--text-muted)',
                          fontSize: tokens.size.xs, fontWeight: 600,
                          cursor: 'pointer', fontFamily: tokens.font.ui,
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        <Lock size={12} /> Lock: {lockDefault.charAt(0).toUpperCase() + lockDefault.slice(1)}
                      </button>
                      <button
                        onClick={() => setShowLockDropdown(!showLockDropdown)}
                        style={{
                          padding: '5px 7px',
                          borderRadius: `0 ${tokens.sm}px ${tokens.sm}px 0`,
                          border: '1px solid var(--border)',
                          background: 'transparent',
                          color: 'var(--text-muted)',
                          fontSize: 10, cursor: 'pointer',
                          display: 'flex', alignItems: 'center',
                        }}
                      >
                        <ChevronDown size={12} />
                      </button>
                    </div>
                    {showLockDropdown && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, marginTop: 4,
                        borderRadius: tokens.md, background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        boxShadow: 'var(--shadow-md)', padding: 4, zIndex: 10,
                        minWidth: 130,
                      }}>
                        {(['pass', 'date', 'manual'] as const).map(t => (
                          <button
                            key={t}
                            onClick={() => {
                              setLockDefault(t);
                              setShowLockDropdown(false);
                              batchAction('lock_type', t);
                            }}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left',
                              padding: '7px 12px', borderRadius: tokens.sm,
                              fontSize: tokens.size.sm, border: 'none',
                              background: 'transparent', color: 'var(--text)',
                              cursor: 'pointer', fontFamily: tokens.font.ui,
                              textTransform: 'capitalize',
                            }}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()
        )}

        {selected.size === 0 && (
          <>
            <IconBtn onClick={() => batchAction('hidden', true)}>
              <EyeOff size={12} /> Hide
            </IconBtn>
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex' }}>
                <button
                  onClick={() => batchAction('lock_type', lockDefault)}
                  style={{
                    padding: '5px 10px', borderRadius: `${tokens.sm}px 0 0 ${tokens.sm}px`,
                    borderRight: 'none',
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    fontSize: tokens.size.xs, fontWeight: 600,
                    cursor: 'pointer', fontFamily: tokens.font.ui,
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Lock size={12} /> Lock: {lockDefault.charAt(0).toUpperCase() + lockDefault.slice(1)}
                </button>
                <button
                  onClick={() => setShowLockDropdown(!showLockDropdown)}
                  style={{
                    padding: '5px 7px',
                    borderRadius: `0 ${tokens.sm}px ${tokens.sm}px 0`,
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    fontSize: 10, cursor: 'pointer',
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  <ChevronDown size={12} />
                </button>
              </div>
              {showLockDropdown && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: 4,
                  borderRadius: tokens.md, background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  boxShadow: 'var(--shadow-md)', padding: 4, zIndex: 10,
                  minWidth: 130,
                }}>
                  {(['pass', 'date', 'manual'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => {
                        setLockDefault(t);
                        setShowLockDropdown(false);
                        batchAction('lock_type', t);
                      }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '7px 12px', borderRadius: tokens.sm,
                        fontSize: tokens.size.sm, border: 'none',
                        background: 'transparent', color: 'var(--text)',
                        cursor: 'pointer', fontFamily: tokens.font.ui,
                        textTransform: 'capitalize',
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={handleCapture} style={primaryBtn()}>
            <Upload size={14} /> Capture
          </button>
        </div>
      </div>

      {/* Content tree */}
      {loading ? (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="skeleton-shimmer" style={{
              height: 52, borderRadius: tokens.md,
              marginLeft: (i - 1) * 22,
            }} />
          ))}
        </div>
      ) : tree.length === 0 ? (
        <EmptyState
          icon={<FileText size={40} />}
          message="No content items found. Click Capture to scan courses."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {tree.map(item => renderItem(item, 0))}
        </div>
      )}

      {/* Edit modal */}
      {editItem && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)',
        }}>
          <div style={{
            maxWidth: 640, width: '90%', maxHeight: '90vh', overflowY: 'auto',
            background: 'var(--bg-card)', borderRadius: 16,
            padding: 28, border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-lg)',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: 24,
            }}>
              <div>
                <h3 style={{
                  fontSize: 18, fontWeight: 700, color: 'var(--text)',
                  letterSpacing: '-0.02em', fontFamily: tokens.font.ui,
                }}>
                  Edit Item
                </h3>
                <p style={{
                  fontSize: tokens.size.sm, color: 'var(--text-muted)',
                  fontFamily: tokens.font.mono, marginTop: 2,
                }}>
                  {editItem.id}
                </p>
              </div>
              <button onClick={closeEdit} style={{
                width: 32, height: 32, borderRadius: tokens.sm,
                border: '1px solid var(--border)',
                background: 'transparent', cursor: 'pointer',
                color: 'var(--text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Field label="Title">
                <input
                  value={editForm.title}
                  onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                  style={inputStyle}
                />
              </Field>

              <Field label="Lock Type">
                <select
                  value={editForm.lock_type}
                  onChange={e => setEditForm(f => ({ ...f, lock_type: e.target.value }))}
                  style={selectStyle}
                >
                  <option value="">None</option>
                  <option value="pass">Pass Required</option>
                  <option value="date">Date-based</option>
                  <option value="manual">Manual Release</option>
                </select>
              </Field>

              {editForm.lock_type === 'date' && (
                <Field label="Lock Value">
                  <input
                    value={editForm.lock_value}
                    onChange={e => setEditForm(f => ({ ...f, lock_value: e.target.value }))}
                    placeholder="e.g. 31/12/26 or 7 days"
                    style={{ ...inputStyle, fontFamily: tokens.font.mono }}
                  />
                  <p style={{
                    fontSize: tokens.size.xs, color: 'var(--text-muted)',
                    marginTop: 4, fontFamily: tokens.font.ui,
                  }}>
                    Formats: DD/MM/YY, X days, X weeks, X months, X years
                  </p>
                </Field>
              )}

              <Field label="Prerequisites (comma-separated IDs)">
                <input
                  value={editForm.prerequisites}
                  onChange={e => setEditForm(f => ({ ...f, prerequisites: e.target.value }))}
                  placeholder="foundation-introduction,fundamentals-setup"
                  style={{ ...inputStyle, fontFamily: tokens.font.mono }}
                />
              </Field>

              <Field label="Hidden">
                <select
                  value={editForm.hidden}
                  onChange={e => setEditForm(f => ({ ...f, hidden: e.target.value }))}
                  style={selectStyle}
                >
                  <option value="false">Visible</option>
                  <option value="true">Hidden</option>
                </select>
              </Field>

              <Field label="Body (raw markdown)">
                <textarea
                  value={editForm.body}
                  onChange={e => setEditForm(f => ({ ...f, body: e.target.value }))}
                  rows={10}
                  style={{
                    ...inputStyle, fontFamily: tokens.font.mono,
                    resize: 'vertical', lineHeight: 1.6,
                  }}
                />
              </Field>

              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button onClick={saveEdit} style={primaryBtn()}>Save</button>
                <button onClick={closeEdit} style={secondaryBtn()}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
