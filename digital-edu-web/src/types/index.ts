export interface ApiResponse<T> {
  data?: T;
  error?: string;
  authenticated?: boolean;
}

export interface UserProfile {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: string;
  profile_pic: string;
  date_joined: string;
}

export interface CourseListItem {
  id: string;
  name: string;
  type: 'category';
  description: string;
  image: string;
  total: number;
  completed_count: number;
  section_count: number;
  children: CourseListItem[];
  hidden?: boolean;
}

export interface CourseDetail {
  id: string;
  name: string;
  description: string;
  image: string;
  total: number;
  completed_count: number;
  progress_pct: number;
  section_count: number;
  level: string;
  expected_hours: string;
}

export interface CurriculumNode {
  id: string;
  name: string;
  type: string;
  content_type?: string;
  depth: number;
  locked: boolean;
  completed: boolean;
  total?: number;
  completed_count?: number;
  children?: CurriculumNode[];
  step_count?: number;
  step_index?: number;
}

export interface Rewrite {
  from: string;
  to: string;
}

export interface ContentDetail {
  id: string;
  title: string;
  name: string;
  type: string;
  body: string;
  rendered_body?: string;
  assessments: Assessment[];
  breadcrumb: BreadcrumbItem[];
  meta: Record<string, any>;
  lecture_data?: LectureData;
  test_data?: TestData;
  seed?: string;
  step_count?: number;
  lab?: LabData;
  rewrites?: Rewrite[];
  completed?: boolean;
  locked?: boolean;
}

export interface Assessment {
  type: string;
  questions?: Question[];
  steps?: WorkshopStep[];
  requirements?: Requirement[];
  container_id?: string;
}

export interface Question {
  question: string;
  options: string[];
  correct: number;
}

export interface WorkshopStep {
  step: number;
  title: string;
  description: string;
  seed?: string;
  solution?: string;
  seed_files?: { language: string; code: string }[];
  hints?: { text: string; code: string }[];
}

export interface LabSeedFile {
  language: string;
  code: string;
}

export interface LabAsset {
  name: string;
  url: string;
  type: string;
}

export interface LabData {
  description: string;
  hints: { text: string; code: string }[];
  seed_files: LabSeedFile[];
  solution: string;
  assets?: LabAsset[];
  asset_base?: string;
  rewrites?: Rewrite[];
}

export interface LabUserStory {
  id: string;
  text: string;
  passed: boolean;
  checked: boolean;
}

export interface LabHint {
  id: string;
  text: string;
  testCode: string;
}

export interface LabStoryHint {
  storyId: string;
  hintIds: string[];
}

export interface Requirement {
  label: string;
  rule: string;
}

export interface BreadcrumbItem {
  id: string;
  name: string;
  title: string;
}

export interface Reference {
  name: string;
  ext: string;
  type: string;
  url?: string;
  content?: string;
}

export interface ProgressData {
  step_index: number;
  completed: boolean;
  score: number;
  passed: boolean;
  verdict: string;
  submission?: string;
}

export interface LearnNext {
  id: string;
  name: string;
  type: string;
  breadcrumb: BreadcrumbItem[];
}

export type LearnResult = LearnNext | { done: true };

export interface BadgeItem {
  id: number;
  badge_id: number;
  name: string;
  description: string;
  icon: string;
  awarded_at: string;
}

export interface TestData {
  description: string;
  question_count: number;
  pass_threshold?: number;
}

export interface InteractiveBlock {
  lang: string;
  code: string;
}

export interface NoteOption {
  text: string;
  feedback: string | null;
}

export interface NoteQuestion {
  text: string;
  options: NoteOption[];
  correct_index: number;
}

export interface AdminDashboardStats {
  total_users: number;
  total_progress: number;
  completed: number;
  content_count: number;
}

export interface AdminUser {
  id: number;
  email: string;
  username: string;
  role: string;
  banned: boolean;
  muted: boolean;
  completed: number;
  restriction_count: number;
  date_joined: string | null;
}

export interface RestrictionItem {
  id: number;
  content_id: string;
  created_at: string | null;
}

export interface AdminContentItem {
  id: string;
  title?: string;
  name?: string;
  type: string;
  depth: number;
  children?: AdminContentItem[];
}

export interface AdminSubmission {
  id: number;
  user_id: number;
  username: string;
  content_id: string;
  submission: string;
  verdict: string | null;
  completed: boolean;
}

export interface CertTemplate {
  id: number;
  name: string;
  header: string;
  subtitle: string;
  description: string;
  issuer: string;
  footer: string;
}

export interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  authenticated?: boolean;
  profile_pic?: string;
  full_name?: string;
  date_joined?: string;
}

export interface AuthResponse extends User {
  authenticated: boolean;
  message?: string;
  error?: string;
}

export interface AdminBadge {
  id: number;
  name: string;
  description: string;
  icon: string;
  badge_type: string;
  config: Record<string, any>;
  enabled: boolean;
  created_at: string | null;
}

export interface LectureData {
  content_section: string;
  content_type: 'interactive' | 'description';
  interactive_blocks: InteractiveBlock[];
  questions: NoteQuestion[];
}
