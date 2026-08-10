import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { Settings as SettingsIcon, Lock, Eye, EyeOff, Save } from 'lucide-react';
import type { UserProfile } from '@/types';

export default function SettingsPage() {
  const { toast } = useToast();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [visibility, setVisibility] = useState('public');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [changingPw, setChangingPw] = useState(false);

  useEffect(() => {
    api.profile().then((p: any) => {
      setProfile(p);
      setVisibility(p.profile_visibility || 'public');
    }).catch(() => {});
  }, []);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await api.updateSettings({ visibility });
      toast('Settings saved');
    } catch (err: any) {
      toast(err.message || 'Failed to save', true);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw !== confirmPw) {
      toast('Passwords do not match', true);
      return;
    }
    setChangingPw(true);
    try {
      await api.changePassword(currentPw, newPw, confirmPw);
      toast('Password changed');
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (err: any) {
      toast(err.message || 'Failed to change password', true);
    } finally {
      setChangingPw(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    boxShadow: 'var(--shadow-lg)',
    padding: '32px',
    marginBottom: 24,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    backgroundColor: 'var(--bg-elevated)',
    color: 'var(--text)',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: 6,
    display: 'block',
  };

  return (
    <div style={{ minHeight: '100vh', padding: '32px 24px', maxWidth: 640, margin: '0 auto' }}>
      <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          backgroundColor: 'var(--accent-glow-strong)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <SettingsIcon size={20} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Settings</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Manage your account preferences</p>
        </div>
      </div>

      {profile && (
        <div style={cardStyle}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Profile</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            {profile.email} &middot; {profile.role}
          </p>

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Profile Visibility</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {['public', 'private'].map((v) => (
                <button
                  key={v}
                  onClick={() => setVisibility(v)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: `1px solid ${visibility === v ? 'var(--accent)' : 'var(--border)'}`,
                    backgroundColor: visibility === v ? 'var(--accent-glow-strong)' : 'var(--bg-elevated)',
                    color: visibility === v ? 'var(--accent)' : 'var(--text-secondary)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {v === 'public' ? <Eye size={14} /> : <EyeOff size={14} />}
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSaveSettings}
            disabled={saving}
            style={{
              padding: '9px 20px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: 'var(--accent)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Save size={14} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Lock size={16} /> Change Password
        </h2>
        <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Current Password</label>
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              required
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>New Password</label>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              required
              minLength={6}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Confirm New Password</label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              required
              minLength={6}
              style={inputStyle}
            />
          </div>
          <button
            type="submit"
            disabled={changingPw}
            style={{
              padding: '10px 0',
              borderRadius: 8,
              border: 'none',
              backgroundColor: 'var(--accent)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: changingPw ? 'not-allowed' : 'pointer',
              opacity: changingPw ? 0.7 : 1,
              marginTop: 4,
            }}
          >
            {changingPw ? 'Changing...' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
