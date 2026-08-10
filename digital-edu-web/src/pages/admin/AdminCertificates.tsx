import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';
import { CertTemplate } from '@/types';
import { useToast } from '@/components/ui/Toast';
import { Save, Award, Plus, FileText } from 'lucide-react';
import {
  tokens, page, PageHeader, Field, Tag, primaryBtn, secondaryBtn,
  inputStyle, sectionCard, sectionTitle, EmptyState, LoadingState,
} from '@/styles/admin';

export default function AdminCertificatesPage() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<CertTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Partial<CertTemplate>>({
    name: '', header: '', subtitle: '', description: '', issuer: '', footer: '',
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [awardForm, setAwardForm] = useState({
    user_id: '', category_id: '', category_title: '',
    subcategory_ids: '', template_id: '',
  });

  useEffect(() => { loadTemplates(); }, []);

  const loadTemplates = () => {
    adminApi.certTemplates()
      .then(data => { setTemplates(data); setLoading(false); })
      .catch(() => { setLoading(false); toast('Failed to load templates', true); });
  };

  const loadTemplate = (tpl: CertTemplate) => {
    setEditingId(tpl.id);
    setForm({
      name: tpl.name, header: tpl.header, subtitle: tpl.subtitle,
      description: tpl.description, issuer: tpl.issuer, footer: tpl.footer,
    });
  };

  const createTemplate = async () => {
    const name = prompt('Template name:');
    if (!name) return;
    try {
      const res = await adminApi.createCertTemplate({ name });
      toast('Template created');
      loadTemplates();
      setEditingId(res.id);
      setForm({
        name, header: 'Certificate of Completion', subtitle: 'D',
        description: 'This is to certify that', issuer: 'Digital-Edu', footer: '',
      });
    } catch (err: any) {
      toast(err.message || 'Failed', true);
    }
  };

  const saveTemplate = async () => {
    const data = { ...form };
    try {
      if (editingId) {
        await adminApi.updateCertTemplate(editingId, data);
      } else {
        await adminApi.createCertTemplate(data);
      }
      toast('Saved!');
      loadTemplates();
    } catch (err: any) {
      toast(err.message || 'Failed to save', true);
    }
  };

  const awardCertificate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminApi.awardCertificate({
        user_id: parseInt(awardForm.user_id),
        category_id: awardForm.category_id,
        category_title: awardForm.category_title,
        subcategory_ids: awardForm.subcategory_ids,
        template_id: awardForm.template_id ? parseInt(awardForm.template_id) : undefined,
      });
      toast('Certificate awarded!');
      setAwardForm({
        user_id: '', category_id: '', category_title: '',
        subcategory_ids: '', template_id: '',
      });
    } catch (err: any) {
      toast(err.message || 'Failed', true);
    }
  };

  return (
    <div style={page}>
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
        marginBottom: 24,
      }}>
        <PageHeader
          title="Certificate System"
          subtitle={`${templates.length} template${templates.length !== 1 ? 's' : ''}`}
        />
        <button onClick={createTemplate} style={primaryBtn()}>
          <Plus size={14} /> New Template
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Templates list */}
          <div style={sectionCard}>
            <h3 style={sectionTitle}>Templates</h3>
            {loading ? (
              <LoadingState />
            ) : templates.length === 0 ? (
              <EmptyState
                icon={<FileText size={36} />}
                message="No templates yet"
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {templates.map(t => (
                  <div
                    key={t.id}
                    onClick={() => loadTemplate(t)}
                    style={{
                      padding: '12px 16px',
                      borderRadius: tokens.md,
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      transition: 'border-color 0.15s',
                      background: editingId === t.id
                        ? 'var(--accent-glow)'
                        : undefined,
                    }}
                    onMouseEnter={e => {
                      if (editingId !== t.id) e.currentTarget.style.borderColor = 'var(--accent)';
                    }}
                    onMouseLeave={e => {
                      if (editingId !== t.id) e.currentTarget.style.borderColor = 'var(--border)';
                    }}
                  >
                    <div style={{
                      fontWeight: 600, fontSize: tokens.size.base,
                      color: 'var(--text)', fontFamily: tokens.font.ui,
                    }}>
                      {t.name}
                    </div>
                    <div style={{
                      fontSize: tokens.size.sm, color: 'var(--text-muted)',
                      marginTop: 3, fontFamily: tokens.font.ui,
                    }}>
                      {t.header} &mdash; {t.issuer}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Template designer */}
          <div style={sectionCard}>
            <h3 style={sectionTitle}>Template Designer</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Name">
                <input
                  value={form.name || ''}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  style={inputStyle}
                />
              </Field>
              <Field label="Header">
                <input
                  value={form.header || ''}
                  onChange={e => setForm(f => ({ ...f, header: e.target.value }))}
                  placeholder="Certificate of Completion"
                  style={inputStyle}
                />
              </Field>
              <Field label="Subtitle">
                <input
                  value={form.subtitle || ''}
                  onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))}
                  placeholder="D"
                  style={inputStyle}
                />
              </Field>
              <Field label="Description">
                <textarea
                  value={form.description || ''}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                  style={{
                    ...inputStyle, resize: 'vertical',
                    lineHeight: 1.6, fontFamily: tokens.font.ui,
                  }}
                />
              </Field>
              <Field label="Issuer">
                <input
                  value={form.issuer || ''}
                  onChange={e => setForm(f => ({ ...f, issuer: e.target.value }))}
                  placeholder="Digital-Edu"
                  style={inputStyle}
                />
              </Field>
              <Field label="Footer">
                <input
                  value={form.footer || ''}
                  onChange={e => setForm(f => ({ ...f, footer: e.target.value }))}
                  style={inputStyle}
                />
              </Field>
              <button onClick={saveTemplate} style={primaryBtn()}>
                <Save size={14} /> Save Template
              </button>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Award form */}
          <div style={sectionCard}>
            <h3 style={sectionTitle}>Award Certificate</h3>
            <form
              onSubmit={awardCertificate}
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
              <Field label="Category ID">
                <input
                  required
                  value={awardForm.category_id}
                  onChange={e => setAwardForm(f => ({ ...f, category_id: e.target.value }))}
                  placeholder="foundation-introduction"
                  style={inputStyle}
                />
              </Field>
              <Field label="Category Title">
                <input
                  required
                  value={awardForm.category_title}
                  onChange={e => setAwardForm(f => ({ ...f, category_title: e.target.value }))}
                  placeholder="Foundation Introduction"
                  style={inputStyle}
                />
              </Field>
              <Field label="Subcategory IDs (comma-separated)">
                <input
                  value={awardForm.subcategory_ids}
                  onChange={e => setAwardForm(f => ({ ...f, subcategory_ids: e.target.value }))}
                  placeholder="operating-system-basics,html-basics"
                  style={{ ...inputStyle, fontFamily: tokens.font.mono }}
                />
              </Field>
              <Field label="Template ID (optional)">
                <input
                  type="number"
                  value={awardForm.template_id}
                  onChange={e => setAwardForm(f => ({ ...f, template_id: e.target.value }))}
                  style={inputStyle}
                />
              </Field>
              <button type="submit" style={{
                ...primaryBtn(),
                background: 'var(--success)',
                justifyContent: 'center',
              }}>
                <Award size={14} /> Award Certificate
              </button>
            </form>
          </div>

          {/* Preview */}
          <div style={sectionCard}>
            <h3 style={sectionTitle}>Preview</h3>
            <div style={{
              padding: '28px 32px',
              borderRadius: tokens.xl,
              textAlign: 'center',
              border: '2px solid var(--border)',
              background: 'var(--bg-card)',
            }}>
              <h1 style={{
                fontSize: 22, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: 2,
                marginBottom: 4, color: 'var(--text)',
                fontFamily: tokens.font.ui,
              }}>
                {form.header || 'Certificate of Completion'}
              </h1>
              <div style={{
                fontSize: 56, fontWeight: 800,
                color: 'var(--accent)', lineHeight: 1,
                marginBottom: 8, fontFamily: tokens.font.ui,
              }}>
                {form.subtitle || 'D'}
              </div>
              <p style={{
                fontSize: tokens.size.sm, lineHeight: 1.6,
                maxWidth: 400, margin: '0 auto 16px',
                color: 'var(--text-muted)', fontFamily: tokens.font.ui,
              }}>
                {form.description || 'This is to certify that'}
              </p>
              <p style={{
                fontSize: 18, fontWeight: 600,
                marginBottom: 4, color: 'var(--text)',
                fontFamily: tokens.font.ui,
              }}>
                [Student Name]
              </p>
              <p style={{
                fontSize: tokens.size.sm, marginBottom: 4,
                color: 'var(--text-muted)', fontFamily: tokens.font.ui,
              }}>
                has successfully completed the course
              </p>
              <p style={{
                fontSize: 16, fontWeight: 600,
                marginBottom: 12, color: 'var(--accent)',
                fontFamily: tokens.font.ui,
              }}>
                [Course Title]
              </p>
              <div style={{
                fontSize: tokens.size.sm, color: 'var(--text-muted)',
                marginBottom: 16, fontFamily: tokens.font.ui,
              }}>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>Sub-competencies:</p>
                <div style={{
                  display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap',
                }}>
                  <Tag>Operating System Basics</Tag>
                  <Tag>HTML Basics Workshop</Tag>
                </div>
              </div>
              <p style={{
                fontSize: tokens.size.sm, marginBottom: 4,
                color: 'var(--text-muted)', fontFamily: tokens.font.ui,
              }}>
                Awarded by Digital-Edu
              </p>
              <p style={{
                fontSize: tokens.size.xs, marginBottom: 20,
                color: 'var(--text-muted)', fontFamily: tokens.font.ui,
              }}>
                {form.issuer ? 'Prepared by ' + form.issuer : 'Prepared by Digital-Edu'}
              </p>
              <p style={{
                fontSize: tokens.size.sm,
                borderTop: '1px solid var(--border)',
                paddingTop: 12, width: '60%', margin: '0 auto',
                color: 'var(--text-muted)', fontFamily: tokens.font.ui,
              }}>
                Date: {new Date().toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'long', year: 'numeric',
                })}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
