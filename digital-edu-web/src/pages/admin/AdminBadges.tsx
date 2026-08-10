import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';
import { AdminBadge } from '@/types';
import { useToast } from '@/components/ui/Toast';
import {
  Plus, Award as AwardIcon, ToggleLeft, ToggleRight,
  Medal, X,
} from 'lucide-react';
import {
  tokens, page, PageHeader, Field, IconBtn, Badge,
  primaryBtn, secondaryBtn, inputStyle, selectStyle,
  sectionCard, sectionTitle, EmptyState, LoadingState,
} from '@/styles/admin';

export default function AdminBadgesPage() {
  const { toast } = useToast();
  const [badges, setBadges] = useState<AdminBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: '', description: '', icon: 'award', badge_type: 'streak',
  });
  const [config, setConfig] = useState<Record<string, any>>({});
  const [awardForm, setAwardForm] = useState({ user_id: '', badge_id: '' });

  useEffect(() => {
    adminApi.badges()
      .then(data => { setBadges(data); setLoading(false); })
      .catch(() => { setLoading(false); toast('Failed to load badges', true); });
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: '', description: '', icon: 'award', badge_type: 'streak' });
    setConfig({});
    setShowModal(true);
  };

  const openEdit = async (id: number) => {
    try {
      const list = await adminApi.badges();
      const b = list.find(x => x.id === id);
      if (!b) return;
      setEditingId(b.id);
      setForm({
        name: b.name, description: b.description,
        icon: b.icon, badge_type: b.badge_type,
      });
      setConfig(b.config || {});
      setShowModal(true);
    } catch {
      toast('Failed to load badge', true);
    }
  };

  const closeModal = () => setShowModal(false);

  const saveBadge = async () => {
    const data = { ...form, config };
    try {
      if (editingId) {
        await adminApi.updateBadge(editingId, data);
        toast('Badge updated');
      } else {
        await adminApi.createBadge(data);
        toast('Badge created');
      }
      closeModal();
      const updated = await adminApi.badges();
      setBadges(updated);
    } catch (err: any) {
      toast(err.message || 'Failed to save', true);
    }
  };

  const toggleBadge = async (id: number) => {
    try {
      await adminApi.toggleBadge(id);
      toast('Toggled');
      setBadges(prev => prev.map(b => b.id === id ? { ...b, enabled: !b.enabled } : b));
    } catch (err: any) {
      toast(err.message || 'Failed', true);
    }
  };

  const awardBadge = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminApi.awardBadge({
        user_id: parseInt(awardForm.user_id),
        badge_id: parseInt(awardForm.badge_id),
      });
      toast('Badge awarded!');
      setAwardForm({ user_id: '', badge_id: '' });
    } catch (err: any) {
      toast(err.message || 'Failed to award', true);
    }
  };

  const badgeTypeLabel = (type: string) =>
    type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div style={page}>
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
        marginBottom: 24,
      }}>
        <PageHeader
          title="Badge System"
          subtitle={`${badges.length} badge${badges.length !== 1 ? 's' : ''}`}
        />
        <button onClick={openCreate} style={primaryBtn()}>
          <Plus size={14} /> New Badge
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, alignItems: 'start' }}>
        {/* Badge list */}
        <div style={sectionCard}>
          <h3 style={sectionTitle}>Badges</h3>
          {loading ? (
            <LoadingState />
          ) : badges.length === 0 ? (
            <EmptyState
              icon={<Medal size={36} />}
              message="No badges yet"
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {badges.map(b => (
                <div
                  key={b.id}
                  style={{
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: tokens.md,
                    border: '1px solid var(--border)',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: tokens.md,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: b.enabled
                        ? 'var(--accent-glow-strong)'
                        : 'var(--bg-elevated)',
                      color: b.enabled ? 'var(--accent)' : 'var(--text-muted)',
                    }}>
                      <AwardIcon size={18} />
                    </div>
                    <div>
                      <div style={{
                        fontWeight: 600, fontSize: tokens.size.base,
                        color: 'var(--text)',
                        display: 'flex', alignItems: 'center', gap: 6,
                        fontFamily: tokens.font.ui,
                      }}>
                        {b.name}
                        {!b.enabled && (
                          <Badge variant="default">Disabled</Badge>
                        )}
                      </div>
                      <div style={{
                        fontSize: tokens.size.sm,
                        color: 'var(--text-muted)',
                        marginTop: 2,
                        fontFamily: tokens.font.ui,
                      }}>
                        {badgeTypeLabel(b.badge_type)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <IconBtn onClick={() => toggleBadge(b.id)}>
                      {b.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                      {b.enabled ? 'Disable' : 'Enable'}
                    </IconBtn>
                    <IconBtn onClick={() => openEdit(b.id)}>Edit</IconBtn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Award form */}
        <div style={{ ...sectionCard, alignSelf: 'start' }}>
          <h3 style={sectionTitle}>Award Badge</h3>
          <form
            onSubmit={awardBadge}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <Field label="User ID">
              <input
                type="number" required
                value={awardForm.user_id}
                onChange={e => setAwardForm(f => ({ ...f, user_id: e.target.value }))}
                style={inputStyle}
              />
            </Field>
            <Field label="Badge ID">
              <input
                type="number" required
                value={awardForm.badge_id}
                onChange={e => setAwardForm(f => ({ ...f, badge_id: e.target.value }))}
                style={inputStyle}
              />
            </Field>
            <button type="submit" style={{
              ...primaryBtn(),
              background: 'var(--success)',
              justifyContent: 'center',
            }}>
              <AwardIcon size={14} /> Award
            </button>
          </form>
        </div>
      </div>

      {/* Create/Edit modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)',
        }}>
          <div style={{
            maxWidth: 500, width: '90%',
            background: 'var(--bg-card)',
            borderRadius: 16, padding: 28,
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-lg)',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: 24,
            }}>
              <h3 style={{
                fontSize: 18, fontWeight: 700, color: 'var(--text)',
                letterSpacing: '-0.02em', fontFamily: tokens.font.ui,
              }}>
                {editingId ? 'Edit Badge' : 'Create Badge'}
              </h3>
              <button onClick={closeModal} style={{
                width: 32, height: 32, borderRadius: tokens.sm,
                border: '1px solid var(--border)',
                background: 'transparent', cursor: 'pointer',
                color: 'var(--text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  required style={inputStyle}
                />
              </Field>
              <Field label="Description">
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  style={{
                    ...inputStyle, resize: 'vertical', lineHeight: 1.6,
                  }}
                />
              </Field>
              <Field label="Icon">
                <select
                  value={form.icon}
                  onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                  style={selectStyle}
                >
                  {['award', 'medal', 'star', 'zap', 'flame', 'target', 'trophy'].map(icon => (
                    <option key={icon} value={icon}>
                      {icon.charAt(0).toUpperCase() + icon.slice(1)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Badge Type">
                <select
                  value={form.badge_type}
                  onChange={e => {
                    setForm(f => ({ ...f, badge_type: e.target.value }));
                    setConfig({});
                  }}
                  style={selectStyle}
                >
                  <option value="streak">Streak (date-based)</option>
                  <option value="course_completion">Course Completion</option>
                  <option value="combo">Combo (courses + deadline)</option>
                  <option value="certificate">Certificate</option>
                  <option value="events">Events</option>
                </select>
              </Field>
              <Field label="Configuration">
                <div style={{
                  padding: 14, borderRadius: tokens.md,
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                  <ConfigEditor type={form.badge_type} config={config} onChange={setConfig} />
                </div>
              </Field>
              <div style={{
                display: 'flex', justifyContent: 'flex-end',
                gap: 8, marginTop: 8,
              }}>
                <button onClick={closeModal} style={secondaryBtn()}>Cancel</button>
                <button onClick={saveBadge} style={primaryBtn()}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigEditor({
  type, config, onChange,
}: {
  type: string;
  config: Record<string, any>;
  onChange: (c: Record<string, any>) => void;
}) {
  const iStyle = { ...inputStyle, fontSize: tokens.size.sm };

  switch (type) {
    case 'streak':
      return (
        <Field label="Min Streak Days">
          <input
            type="number"
            value={config.min_streak || 3}
            onChange={e => onChange({ ...config, min_streak: parseInt(e.target.value) || 3 })}
            min={1}
            style={iStyle}
          />
        </Field>
      );
    case 'course_completion':
      return (
        <Field label="Course IDs (comma-separated)">
          <input
            value={(config.course_ids || []).join(',')}
            onChange={e => onChange({
              ...config,
              course_ids: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean),
            })}
            placeholder="os-basics,html-workshop"
            style={{ ...iStyle, fontFamily: tokens.font.mono }}
          />
        </Field>
      );
    case 'combo':
      return (
        <>
          <Field label="Course IDs (comma-separated)">
            <input
              value={(config.course_ids || []).join(',')}
              onChange={e => onChange({
                ...config,
                course_ids: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean),
              })}
              placeholder="os-basics,html-workshop"
              style={{ ...iStyle, fontFamily: tokens.font.mono }}
            />
          </Field>
          <Field label="Deadline (YYYY-MM-DD, optional)">
            <input
              type="date"
              value={config.deadline || ''}
              onChange={e => onChange({ ...config, deadline: e.target.value })}
              style={iStyle}
            />
          </Field>
        </>
      );
    case 'certificate':
      return (
        <Field label="Certificate Category IDs (comma-separated)">
          <input
            value={(config.certificate_ids || []).join(',')}
            onChange={e => onChange({
              ...config,
              certificate_ids: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean),
            })}
            placeholder="foundation-introduction"
            style={{ ...iStyle, fontFamily: tokens.font.mono }}
          />
        </Field>
      );
    case 'events':
      return (
        <Field label="Event Type">
          <select
            value={config.event_type || 'first_certificate'}
            onChange={e => onChange({ ...config, event_type: e.target.value })}
            style={iStyle}
          >
            <option value="first_certificate">First Certificate</option>
            <option value="first_completion">First Completion</option>
            <option value="ten_completions">10 Completions</option>
            <option value="all_courses">All Courses</option>
          </select>
        </Field>
      );
    default:
      return null;
  }
}
