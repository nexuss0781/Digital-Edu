import { useEffect, useState, useCallback } from 'react';
import { adminApi } from '@/lib/api';
import { AdminUser, RestrictionItem } from '@/types';
import { useToast } from '@/components/ui/Toast';
import {
  Ban, Undo2, Shield, ShieldOff, VolumeX, Volume2,
  Search, X, UserCog, Lock, Mail, Calendar, Users,
} from 'lucide-react';
import {
  tokens, page, PageHeader, Badge, IconBtn,
  primaryBtn, secondaryBtn, inputStyle,
  sectionCard, sectionLabel,
  tableHead, tableCell, tableRowHover,
  EmptyState, LoadingState,
} from '@/styles/admin';

export default function AdminUsersPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [restrictions, setRestrictions] = useState<RestrictionItem[]>([]);
  const [restrictionInput, setRestrictionInput] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  const loadUsers = useCallback(async (q?: string) => {
    try {
      const data = await adminApi.users(q);
      setUsers(data);
    } catch {
      toast('Failed to load users', true);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleSearch = () => {
    setLoading(true);
    loadUsers(search || undefined);
  };

  const clearSearch = () => {
    setSearch('');
    setLoading(true);
    loadUsers();
  };

  const openDetail = async (u: AdminUser) => {
    setSelected(u);
    setDetailLoading(true);
    try {
      const res = await adminApi.getRestrictions(u.id);
      setRestrictions(res);
    } catch {
      setRestrictions([]);
    }
    setDetailLoading(false);
  };

  const closeDetail = () => {
    setSelected(null);
    setRestrictions([]);
  };

  const handleBan = async () => {
    if (!selected) return;
    const duration = prompt('Ban duration (number) or leave empty for permanent:');
    const unit = prompt('Unit: days, weeks, months, years (default: days):') || 'days';
    const reason = prompt('Reason (optional):') || '';
    try {
      await adminApi.banUser(selected.id, { duration: duration || undefined, unit, reason });
      toast('User banned');
      setUsers(prev => prev.map(u => u.id === selected.id ? { ...u, banned: true } : u));
      setSelected(prev => prev ? { ...prev, banned: true } : prev);
    } catch (err: any) {
      toast(err.message || 'Failed to ban', true);
    }
  };

  const handleUnban = async () => {
    if (!selected) return;
    try {
      await adminApi.unbanUser(selected.id);
      toast('User unbanned');
      setUsers(prev => prev.map(u => u.id === selected.id ? { ...u, banned: false } : u));
      setSelected(prev => prev ? { ...prev, banned: false } : prev);
    } catch (err: any) {
      toast(err.message || 'Failed to unban', true);
    }
  };

  const handleRole = async (role: string) => {
    if (!selected) return;
    try {
      await adminApi.setRole(selected.id, role);
      const displayRole = role === 'admin' ? 'instructor' : role;
      toast(`Role set to ${displayRole}`);
      setUsers(prev => prev.map(u => u.id === selected.id ? { ...u, role: displayRole } : u));
      setSelected(prev => prev ? { ...prev, role: displayRole } : prev);
    } catch (err: any) {
      toast(err.message || 'Failed to set role', true);
    }
  };

  const handleMute = async (muted: boolean) => {
    if (!selected) return;
    try {
      await adminApi.toggleMute(selected.id, muted);
      toast(muted ? 'User muted' : 'User unmuted');
      setUsers(prev => prev.map(u => u.id === selected.id ? { ...u, muted } : u));
      setSelected(prev => prev ? { ...prev, muted } : prev);
    } catch (err: any) {
      toast(err.message || 'Failed', true);
    }
  };

  const addRestriction = () => {
    const id = restrictionInput.trim();
    if (!id) return;
    if (restrictions.some(r => r.content_id === id)) {
      toast('Already restricted', true);
      return;
    }
    setRestrictions(prev => [...prev, { id: 0, content_id: id, created_at: null }]);
    setRestrictionInput('');
  };

  const removeRestriction = (contentId: string) => {
    setRestrictions(prev => prev.filter(r => r.content_id !== contentId));
  };

  const saveRestrictions = async () => {
    if (!selected) return;
    try {
      await adminApi.setRestrictions(selected.id, restrictions.map(r => r.content_id));
      toast('Restrictions saved');
      setUsers(prev => prev.map(u => u.id === selected.id ? { ...u, restriction_count: restrictions.length } : u));
    } catch (err: any) {
      toast(err.message || 'Failed to save restrictions', true);
    }
  };

  const getRoleInfo = (role: string) => {
    if (role === 'student') return { label: 'Student', variant: 'default' as const };
    return { label: 'Admin', variant: 'info' as const };
  };

  return (
    <div style={page}>
      <PageHeader
        title="User Management"
        subtitle={`${users.length} user${users.length !== 1 ? 's' : ''} registered`}
      />

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Search */}
          <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <Search size={14} style={{
                position: 'absolute', left: 12, top: '50%',
                transform: 'translateY(-50%)', color: 'var(--text-muted)',
              }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Search by username or email..."
                style={{
                  ...inputStyle,
                  paddingLeft: 36,
                }}
              />
              {search && (
                <button onClick={clearSearch} style={{
                  position: 'absolute', right: 10, top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', padding: 4,
                }}>
                  <X size={14} />
                </button>
              )}
            </div>
            <button onClick={handleSearch} style={primaryBtn()}>
              <Search size={14} /> Search
            </button>
          </div>

          {/* Table */}
          <div style={{
            ...sectionCard, padding: 0, overflow: 'hidden',
          }}>
            <div style={{ maxHeight: 600, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={tableHead}>ID</th>
                    <th style={tableHead}>Username</th>
                    <th style={tableHead}>Email</th>
                    <th style={tableHead}>Role</th>
                    <th style={tableHead}>Status</th>
                    <th style={{ ...tableHead, textAlign: 'right' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 40 }}>
                        <LoadingState />
                      </td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div style={{ padding: 40 }}>
                          <EmptyState
                            icon={<Users size={36} />}
                            message={search ? 'No users match your search' : 'No users found'}
                          />
                        </div>
                      </td>
                    </tr>
                  ) : users.map(u => {
                    const roleInfo = getRoleInfo(u.role);
                    const isSelected = selected?.id === u.id;
                    return (
                      <tr
                        key={u.id}
                        onClick={() => openDetail(u)}
                        style={tableRowHover(isSelected)}
                        onMouseEnter={e => {
                          if (!isSelected) e.currentTarget.style.background = 'var(--accent-glow)';
                        }}
                        onMouseLeave={e => {
                          if (!isSelected) e.currentTarget.style.background = '';
                        }}
                      >
                        <td style={{ ...tableCell, fontFamily: tokens.font.mono, fontSize: tokens.size.sm }}>
                          {u.id}
                        </td>
                        <td style={{
                          ...tableCell, fontWeight: 600,
                        }}>
                          {u.username}
                        </td>
                        <td style={{
                          ...tableCell, color: 'var(--text-muted)',
                          fontSize: tokens.size.sm,
                        }}>
                          {u.email}
                        </td>
                        <td style={tableCell}>
                          <Badge variant={roleInfo.variant}>{roleInfo.label}</Badge>
                        </td>
                        <td style={tableCell}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {u.banned && <Badge variant="danger">Banned</Badge>}
                            {u.muted && <Badge variant="warning">Muted</Badge>}
                            {u.restriction_count > 0 && (
                              <Badge variant="info">{u.restriction_count} restr.</Badge>
                            )}
                            {!u.banned && !u.muted && u.restriction_count === 0 && (
                              <Badge variant="success">Active</Badge>
                            )}
                          </div>
                        </td>
                        <td style={{ ...tableCell, textAlign: 'right' }}>
                          <IconBtn onClick={e => { e.stopPropagation(); openDetail(u); }}>
                            <UserCog size={12} /> Manage
                          </IconBtn>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{
            width: 360,
            flexShrink: 0,
            ...sectionCard,
            position: 'sticky',
            top: 28,
            maxHeight: 'calc(100vh - 110px)',
            overflowY: 'auto',
            padding: 0,
          }}>
            <div style={{
              padding: '18px 20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <h3 style={{
                fontSize: 15, fontWeight: 700, color: 'var(--text)',
                fontFamily: tokens.font.ui,
              }}>
                User Details
              </h3>
              <button onClick={closeDetail} style={{
                width: 28, height: 28, borderRadius: tokens.sm,
                border: 'none', background: 'var(--bg)',
                cursor: 'pointer', color: 'var(--text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <X size={14} />
              </button>
            </div>

            <div style={{ padding: 20 }}>
              {/* Profile header */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: tokens.md,
                    background: 'linear-gradient(135deg, var(--accent), var(--accent-light))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 17, color: '#fff',
                    fontFamily: tokens.font.ui,
                  }}>
                    {selected.username[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{
                      fontWeight: 700, fontSize: 15, color: 'var(--text)',
                      fontFamily: tokens.font.ui,
                    }}>
                      {selected.username}
                    </div>
                    <div style={{
                      fontSize: tokens.size.sm, color: 'var(--text-muted)',
                      display: 'flex', alignItems: 'center', gap: 4,
                      fontFamily: tokens.font.ui,
                    }}>
                      <Mail size={11} /> {selected.email}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                  <Badge variant={getRoleInfo(selected.role).variant}>
                    {getRoleInfo(selected.role).label}
                  </Badge>
                  {selected.banned && <Badge variant="danger">Banned</Badge>}
                  {selected.muted && <Badge variant="warning">Muted</Badge>}
                </div>
                <div style={{
                  fontSize: tokens.size.sm, color: 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontFamily: tokens.font.ui,
                }}>
                  <Calendar size={11} />
                  Joined {selected.date_joined
                    ? new Date(selected.date_joined).toLocaleDateString()
                    : 'N/A'}
                  <span style={{ margin: '0 6px' }}>&middot;</span>
                  {selected.completed} lessons completed
                </div>
              </div>

              {/* Actions */}
              <div style={{ marginBottom: 20 }}>
                <div style={sectionLabel}>Actions</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {selected.banned ? (
                    <IconBtn onClick={handleUnban}><Undo2 size={12} /> Unban</IconBtn>
                  ) : (
                    <IconBtn onClick={handleBan} style={{ color: 'var(--danger)' }}>
                      <Ban size={12} /> Ban
                    </IconBtn>
                  )}
                  {selected.muted ? (
                    <IconBtn onClick={() => handleMute(false)}>
                      <Volume2 size={12} /> Unmute
                    </IconBtn>
                  ) : (
                    <IconBtn onClick={() => handleMute(true)} style={{ color: '#D97706' }}>
                      <VolumeX size={12} /> Mute
                    </IconBtn>
                  )}
                </div>
              </div>

              {/* Role */}
              <div style={{ marginBottom: 20 }}>
                <div style={sectionLabel}>Role</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <IconBtn
                    onClick={() => handleRole('student')}
                    style={selected.role === 'student' ? {
                      background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)',
                    } : undefined}
                  >
                    <ShieldOff size={12} /> Student
                  </IconBtn>
                  <IconBtn
                    onClick={() => handleRole('instructor')}
                    style={selected.role === 'instructor' || selected.role === 'admin' ? {
                      background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)',
                    } : undefined}
                  >
                    <Shield size={12} /> Admin
                  </IconBtn>
                </div>
              </div>

              {/* Restrictions */}
              <div>
                <div style={sectionLabel}>
                  Course Restrictions ({restrictions.length})
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <input
                    value={restrictionInput}
                    onChange={e => setRestrictionInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addRestriction()}
                    placeholder="Add content ID..."
                    style={{
                      ...inputStyle,
                      fontSize: tokens.size.sm,
                      fontFamily: tokens.font.mono,
                    }}
                  />
                  <button onClick={addRestriction} style={{
                    ...primaryBtn(),
                    padding: '8px 12px', fontSize: tokens.size.sm,
                  }}>
                    Add
                  </button>
                </div>
                {detailLoading ? (
                  <LoadingState text="Loading restrictions..." />
                ) : restrictions.length === 0 ? (
                  <div style={{
                    fontSize: tokens.size.sm, color: 'var(--text-muted)',
                    padding: '8px 0', fontFamily: tokens.font.ui,
                  }}>
                    No restrictions
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                    {restrictions.map(r => (
                      <div key={r.content_id} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '6px 10px', borderRadius: tokens.sm,
                        background: 'var(--bg)', border: '1px solid var(--border)',
                      }}>
                        <span style={{
                          fontSize: tokens.size.sm, fontFamily: tokens.font.mono,
                          color: 'var(--text)',
                        }}>
                          {r.content_id}
                        </span>
                        <button
                          onClick={() => removeRestriction(r.content_id)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--danger)', padding: 2,
                          }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={saveRestrictions} style={{
                  ...primaryBtn(),
                  background: 'var(--success)',
                  fontSize: tokens.size.sm,
                }}>
                  <Lock size={12} /> Save Restrictions
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
