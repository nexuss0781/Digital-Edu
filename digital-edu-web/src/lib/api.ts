import type { ApiResponse, CourseListItem, CourseDetail, CurriculumNode, Reference, ContentDetail, ProgressData, BadgeItem, UserProfile, AdminDashboardStats, AdminUser, AdminSubmission, CertTemplate, AdminBadge, RestrictionItem, AuthResponse, LearnResult } from '@/types';

const API_URL = import.meta.env.VITE_API_URL || '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Auth
  me: () => request<AuthResponse>('/api/v1/auth/me'),
  login: (email: string, password: string) =>
    request<AuthResponse>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email: string, username: string, password: string) =>
    request<AuthResponse>('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, username, password }) }),
  logout: async () => {
    try {
      await fetch(`${API_URL}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Swallow network/redirect errors — client-side logout must still proceed.
    }
  },

  // Courses
  courses: () => request<CourseListItem[]>('/api/v1/courses'),
  courseDetail: (id: string) => request<CourseDetail>(`/api/v1/courses/${id}`),
  curriculum: (id: string) => request<CurriculumNode>(`/api/v1/courses/${id}/curriculum`),
  structureVersion: () => request<{ version: string }>('/api/v1/meta/version'),
  overview: (id: string) => request<{ html: string }>(`/api/v1/courses/${id}/overview`),
  references: (id: string) => request<{ references: Reference[] }>(`/api/v1/courses/${id}/references`),

  // Content
  content: (id: string) => request<ContentDetail>(`/api/v1/content/${id}`),
  learn: () => request<LearnResult>('/api/v1/learn'),

  // Progress
  progress: (id: string) => request<ProgressData>(`/api/v1/progress/${id}`),
  completeContent: (id: string, data?: any) =>
    request(`/api/v1/progress/${id}/complete`, { method: 'POST', body: JSON.stringify(data || {}) }),
  saveStep: (id: string, stepIndex: number, code: string, contentType?: string) =>
    request(`/api/v1/progress/${id}/step`, {
      method: 'POST',
      body: JSON.stringify({ step_index: stepIndex, code, content_type: contentType || 'workshop' }),
    }),
  activity: () => request<Record<string, { count: number }>>('/api/v1/progress/activity'),
  badges: () => request<BadgeItem[]>('/api/v1/progress/badges'),
  streak: () => request<{ streak: number }>('/api/v1/progress/streak'),

  // User
  profile: () => request<UserProfile>('/api/v1/user/profile'),
  updateSettings: (data: any) =>
    request('/api/v1/user/settings', { method: 'POST', body: JSON.stringify(data) }),
  changePassword: (current: string, newPw: string, confirm: string) =>
    request('/api/v1/user/change-password', { method: 'POST', body: JSON.stringify({ current_password: current, new_password: newPw, confirm_password: confirm }) }),
};

export const adminApi = {
  dashboard: () => request<AdminDashboardStats>('/admin/api/dashboard'),
  users: (q?: string) => request<AdminUser[]>(`/admin/api/users${q ? '?q=' + encodeURIComponent(q) : ''}`),
  banUser: (userId: number, data: { duration?: string; unit?: string; reason?: string }) =>
    request(`/admin/api/users/${userId}/ban`, { method: 'POST', body: JSON.stringify(data) }),
  unbanUser: (userId: number) =>
    request(`/admin/api/users/${userId}/unban`, { method: 'POST' }),
  setRole: (userId: number, role: string) =>
    request(`/admin/api/users/${userId}/role`, { method: 'POST', body: JSON.stringify({ role }) }),
  toggleMute: (userId: number, muted: boolean) =>
    request(`/admin/api/users/${userId}/mute`, { method: 'POST', body: JSON.stringify({ muted }) }),
  getRestrictions: (userId: number) =>
    request<RestrictionItem[]>(`/admin/api/users/${userId}/restrictions`),
  setRestrictions: (userId: number, contentIds: string[]) =>
    request(`/admin/api/users/${userId}/restrictions`, { method: 'POST', body: JSON.stringify({ content_ids: contentIds }) }),
  structure: () => request<Record<string, any>>('/admin/api/structure'),
  courseTree: () => request<any[]>('/admin/api/course-tree'),
  capture: () => request<Record<string, any>>('/admin/api/capture', { method: 'POST' }),
  updateItem: (id: string, updates: Record<string, any>) =>
    request('/admin/api/update-item', { method: 'POST', body: JSON.stringify({ id, updates }) }),
  batchUpdate: (ids: string[], updates: Record<string, any>) =>
    request('/admin/api/batch-update', { method: 'POST', body: JSON.stringify({ ids, updates }) }),
  contentPreview: (id: string) =>
    request<{ id: string; title: string; type: string; body: string; path: string }>(`/admin/api/content-preview/${id}`),
  saveContent: (id: string, body: string) =>
    request('/admin/api/save-content', { method: 'POST', body: JSON.stringify({ id, body }) }),
  submissions: () => request<AdminSubmission[]>('/admin/api/submissions'),
  submissionVerdict: (progressId: number, verdict: string) =>
    request(`/admin/api/submissions/${progressId}/verdict`, { method: 'POST', body: JSON.stringify({ verdict }) }),
  certTemplates: () => request<CertTemplate[]>('/admin/api/certificate-templates'),
  createCertTemplate: (data: Partial<CertTemplate>) =>
    request<{ id: number; ok: boolean }>('/admin/api/certificate-templates', { method: 'POST', body: JSON.stringify(data) }),
  updateCertTemplate: (id: number, data: Partial<CertTemplate>) =>
    request(`/admin/api/certificate-templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  awardCertificate: (data: { user_id: number; category_id: string; category_title: string; subcategory_ids?: string; template_id?: number }) =>
    request('/admin/api/award-certificate', { method: 'POST', body: JSON.stringify(data) }),
  certificates: () => request<any[]>('/admin/api/certificates'),
  badges: () => request<AdminBadge[]>('/admin/api/badges'),
  createBadge: (data: Partial<AdminBadge>) =>
    request('/admin/api/badges', { method: 'POST', body: JSON.stringify(data) }),
  updateBadge: (id: number, data: Partial<AdminBadge>) =>
    request(`/admin/api/badges/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  toggleBadge: (id: number) =>
    request(`/admin/api/badges/${id}/toggle`, { method: 'POST' }),
  awardBadge: (data: { user_id: number; badge_id: number }) =>
    request('/admin/api/badges/award', { method: 'POST', body: JSON.stringify(data) }),
};

// Toast helper
let toastFn: ((msg: string, isError?: boolean) => void) | null = null;
export function setToastHandler(fn: typeof toastFn) { toastFn = fn; }
export function showToast(msg: string, isError?: boolean) { toastFn?.(msg, isError); }
