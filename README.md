<div align="center">
  <br/>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="static/favicon.svg">
    <img src="static/favicon.svg" alt="DigitalEdu" width="72" height="72"/>
  </picture>
  <h1 align="center">DigitalEdu</h1>
  <p align="center">
    <strong>Competency-Based Learning Management System</strong>
    <br/>
    <code>nexuss0781/Digital-Edu</code>
  </p>
  <p align="center">
    <a href="https://github.com/nexuss0781/Digital-Edu/stargazers">
      <img src="https://img.shields.io/github/stars/nexuss0781/Digital-Edu?style=flat&logo=github&color=%2300B4FC" alt="Stars"/>
    </a>
    <a href="https://github.com/nexuss0781/Digital-Edu/blob/main/LICENSE">
      <img src="https://img.shields.io/badge/license-MIT-%2300B4FC" alt="License"/>
    </a>
    <img src="https://img.shields.io/badge/python-3.12-%23001A49?logo=python" alt="Python"/>
    <img src="https://img.shields.io/badge/flask-3.1-%23001A49?logo=flask" alt="Flask"/>
    <img src="https://img.shields.io/badge/tests-745%20passing-%2317F9FF" alt="745 tests passing"/>
    <img src="https://img.shields.io/badge/status-production%20ready-%2300B4FC" alt="Production Ready"/>
  </p>
  <p align="center">
    <sub>Built by <strong>DigitalEdu Team</strong> · <a href="https://ethcocoders.gt.tc">Ethco Coders</a></sub>
  </p>
</div>

<br/>

<p align="center">
  <strong>
    <a href="#-features">Features</a> ·
    <a href="#-tech-stack">Tech Stack</a> ·
    <a href="#-getting-started">Getting Started</a> ·
    <a href="#-course-content-format">Content Format</a> ·
    <a href="#-architecture">Architecture</a> ·
    <a href="#-testing">Testing</a> ·
    <a href="#-project-structure">Structure</a>
  </strong>
</p>

<br/>

DigitalEdu transforms a directory of Markdown files into a fully interactive learning platform. Notes, quizzes, tests, exams, hands-on workshops, practical exercises, and projects — all driven by files on disk. Students earn badges, maintain learning streaks, and receive verifiable certificates as they progress.

> **Core philosophy:** The filesystem *is* the course structure. No database configuration needed for course layout. Add a Markdown file, capture the structure, and it appears in the curriculum.

---

## ✨ Features

### Content Types

| Type | Experience |
|---|---|
| **Note** | Rich Markdown article with optional inline quiz at the end |
| **Quiz** | One question at a time, immediate correct/wrong feedback, understanding check |
| **Test** | 5 questions per page, aggregated result, error budget pass logic |
| **Exam** | 10 questions per page, high-stakes qualification, same engine as test |
| **Workshop** | Step-by-step code building with Monaco editor, rule-based validation via API, progress persists per user |
| **Practical** | Full IDE layout — requirements checklist + Monaco code editor + live iframe preview, each requirement validated independently |
| **Project** | Same IDE layout, instructor-reviewed with **Passed** / **Retry** verdict workflow |

All content types use **one unified file format**: Markdown with YAML front-matter. The parser normalizes types (`tests` → `test`, `Quizzes` → `quiz`, etc.), handles plural forms and casing automatically.

### Assessment Engine

- **Three modes** — Quiz (1/page), Test (5/page), Exam (10/page) — same question format, different pacing
- **Pass/fail** — `min_errors` (error budget) or `threshold` (percentage) with sensible defaults
- **Embedding** — any note can include a `<!-- questions -->` block rendered as an inline quiz at the end
- **Type normalization** — case-insensitive, handles plurals and common typos (`quizes` → `quiz`)

### Badge System

Configurable achievements auto-awarded on trigger conditions:

| Type | Trigger | Configuration |
|---|---|---|
| **Streak** | Consecutive daily activity | `min_streak` (days) |
| **Course Completion** | Complete a specified set of courses | `course_ids` |
| **Combo** | Complete courses before a deadline | `course_ids` + `deadline` |
| **Certificate** | Earn specific certificates | `certificate_ids` |
| **Events** | Milestone achievements | `event_type` (first completion, 10 completions, first cert, all courses) |

Admins can create, edit, toggle, and manually award badges. **Disabled badges** are never auto-awarded.

### Contribution Graph & Streaks

A GitHub-style activity heatmap tracks daily learning:
- Every content completion logs to `ActivityLog`
- `/api/progress/activity` — 365 days of contribution data
- `/api/progress/streak` — current streak
- Rendered on the user profile with daily color intensity

### Certificate System

- **Templates** — Admin designs certificates with header, subtitle, description, issuer, footer
- **Awarding** — Select user + category + subcategories + template
- **Display** — Awarded certificates appear on the recipient's profile

### Admin Panel

| Section | Capabilities |
|---|---|
| **Dashboard** | System-wide stats — users, progress, content count |
| **Content** | Visual course tree, capture/rebuild structure, preview and edit Markdown, batch update, lock/unlock items |
| **Users** | List all users, ban with duration (days/weeks/months) and reason, unban |
| **Submissions** | Review project code submissions, issue **Passed** / **Retry** verdict |
| **Certificates** | CRUD templates, award certificates to users |
| **Badges** | CRUD badge definitions, toggle enabled/disabled, manually award |
| **Upload** | File and image upload (PNG, JPG, GIF, SVG, WebP) to `/upload/` |

#### Lock Types

| Type | Behavior |
|---|---|
| **Pass** | Completing current content unlocks the next item |
| **Date** | Scheduled unlock — absolute (`DD/MM/YY`) or relative (`7 days`, `3 weeks`, `6 months`, `2 years`) |
| **Manual** | Toggle on/off via a single button with chevron dropdown |

### User Features

- **Registration / Login** — session-based with role assignment (student, instructor, admin)
- **Dashboard** — completed content summary and progress overview
- **Profile** — avatar, bio, earned badges, awarded certificates, contribution graph
- **Settings** — profile visibility toggle (public/private), password change with validation
- **Course Browser** — card-based layout, prerequisite-locked content, breadcrumb navigation with sibling dropdown
- **Content Viewer** — renders Markdown, embedded assessments, workshops (step-by-step), practicals (IDE layout), projects (IDE + submit)
- **Progress API** — step saving, content completion, project submission, re-submit on retry
- **Security** — Werkzeug password hashing, server-side sessions, banned user detection on every request

---

## 🧰 Tech Stack

| Category | Technology |
|---|---|
| **Runtime** | Python 3.12 |
| **Web Framework** | Flask 3.1 |
| **Authentication** | Flask-Login (session-based) |
| **Session Storage** | Flask-Session (server-side filesystem) |
| **Database** | SQLite via SQLAlchemy 2.0 ORM |
| **Migrations** | Flask-Migrate (Alembic) |
| **Templating** | Jinja2 (server-rendered HTML) |
| **CSS** | Tailwind CSS (CDN) + CSS custom properties |
| **Icons** | Lucide (CDN) |
| **JavaScript** | Vanilla JS (no framework) |
| **Content Parsing** | PyYAML (front-matter), regex (assessment blocks) |
| **Validation** | Structured template-based validator (`app/services/validator.py`), `tag` and `wrapper` templates with well-defined fields, YAML rules in `templates/` |
| **Testing** | Python unittest-style scripts (745 tests) |

---

## 🎨 Color Palette & Design

```
#001449  Deep navy — headings, primary buttons, navbars
#012677  Midnight blue — hover states, active links
#005BC5  Royal blue — secondary accents, focus borders
#00B4FC  Bright cyan — highlights, info badges, icons
#17F9FF  Light cyan — special accents, glowing elements
```

**Design principles:**
- **No pure white or black** — all surfaces use tinted shades for reduced eye strain
- **Card-based layout** — wide cards (1200×627px ratio) that shrink proportionally for deeper subcategories
- **No file-system metaphor** — no folder icons, no expand/collapse tree widgets
- **Breadcrumb navigation** with hover dropdown showing sibling pages
- **Dark/Light mode** via CSS custom properties
- **Toast notifications** replacing native `alert()` dialogs
- **Loading animations and transitions** instead of hard page reloads

---

## 🚀 Getting Started

### Prerequisites

- Python 3.12+
- pip

### Quick Start

```bash
# Clone the repository
git clone https://github.com/nexuss0781/Digital-Edu.git
cd Digital-Edu

# Set up virtual environment
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the application
python3 run.py
```

Open **http://localhost:5000** in your browser.

### Configuration

Environment variables (`.env`):

```env
SECRET_KEY=your-secret-key-here
DATABASE_URL=sqlite:///digital-edu.db
```

### First-Time Admin Setup

```bash
# Start the app, register a user at /auth/register, then:
python3 -c "
from app import create_app, db
from app.models.user import User
app = create_app()
with app.app_context():
    u = User.query.filter_by(email='your@email.com').first()
    u.role = 'admin'
    db.session.commit()
    print('Admin role set.')
"
```

1. Visit `/admin/` and click **Capture Structure** to index your course files
2. Configure locks, prerequisites, badges, and certificate templates

---

## 📝 Course Content Format

Every course content file is a **Markdown file with YAML front-matter**. The `type` field controls rendering.

### Front-Matter Schema

```yaml
---
type: note             # note | quiz | test | exam | workshop | practical | project
id: unique-id          # Used in URLs, prerequisites, and progress tracking
title: Display Title   # Shown in UI
prerequisites: []      # Content IDs that must be completed first
min_errors: 2          # Error budget (test/exam). Pass when errors ≤ this
threshold: 60          # Fallback pass % (used only if min_errors absent, default 50)
---
```

### Content Types in Detail

<details>
<summary><strong>Note</strong> — Plain Markdown with optional embedded quiz</summary>

```markdown
---
type: note
id: os-basics
title: Operating System Basics
prerequisites: [identify-components]
---

## Operating System Basics

An operating system manages hardware and provides services for programs.

<!-- questions
* Which OS is open-source?
- Windows
- macOS
- Linux
- iOS
Answer: C
-->
```
</details>

<details>
<summary><strong>Quiz / Test / Exam</strong> — Assessment with question blocks</summary>

```markdown
---
type: Quiz          # Normalized to 'quiz'
id: hardware-quiz
title: Hardware Quiz
min_errors: 1
---

<!-- questions
* What component is the brain of the computer?
- GPU
- RAM
- CPU
- PSU
Answer: C
-->
```

| Type | Questions per page | Purpose |
|---|---|---|
| `quiz` | 1 | Quick understanding check |
| `test` | 5 | Standard assessment |
| `exam` | 10 | High-stakes qualification |
</details>

<details>
<summary><strong>Workshop</strong> — Step-by-step code building with rule-based validation</summary>

```markdown
---
type: workshop
id: html-basics-workshop
title: HTML Basics Workshop
---

<!-- steps
step: 1
explanation: "Every HTML document starts with a DOCTYPE declaration."
prompt: "Add the DOCTYPE declaration at the top."
validate: "check_doctype"

step: 2
explanation: "The HTML element wraps all content."
prompt: "Add opening and closing html tags."
validate: "check_html_tag"
-->
```

Rules defined in `templates/html_structure.yaml`:
```yaml
check_doctype:
  template: contains
  value: "<!DOCTYPE"
  hint: "Add <!DOCTYPE html> at the top"

check_html_tag:
  template: tag
  element: html
  closing: yes
  hint: "Add <html> and </html> tags"
```

**Structured templates** — `tag` checks ANY tag with `element`, `closing`, `attribute`, `value`. `wrapper` checks parent-child relationships. Legacy `expected` exact-match format still works.
</details>

<details>
<summary><strong>Practical</strong> — IDE layout with requirements + goal + rule-based validation</summary>

```markdown
---
type: practical
id: css-styling-practical
---

<!-- requirements
requirement: "Page has a light blue background"
validate: "check_bg_color"

requirement: "Font size is 16px"
validate: "check_font_size"
-->

<!-- goal
<h1 style="color:#046D8B;">Hello World</h1>
-->
```

Rules defined in `templates/css_rules.yaml`:
```yaml
check_bg_color:
  template: css_property
  property: background-color
  value: "#e0f7fa"
  hint: "Set background-color: #e0f7fa in your CSS"

check_font_size:
  template: css_property
  property: font-size
  value: "16px"
  hint: "Set font-size: 16px in your CSS"
```

**Structured templates** — content creators define rules with well-defined fields (`element`, `closing`, `attribute`, `value`). Legacy `code.includes()` expressions still work via client-side fallback.
</details>

<details>
<summary><strong>Project</strong> — IDE layout, instructor-reviewed</summary>

```markdown
---
type: project
id: final-project
title: Personal Portfolio Page
---

## Final Project

Create a personal portfolio page using HTML and CSS.

### Requirements
- Responsive portfolio page
- Header with name and navigation
- Contact section with form
```
</details>

### Question Format

```
* Question text
- Option A
- Option B
- Option C
- Option D
Answer: B
```

> Full content format reference: [`GUIDE.md`](GUIDE.md)

---

## 🏗 Architecture

```
HTTP Request
    │
    ▼
Flask (create_app)
    │
    ├── Blueprint Dispatch
    │   ├── /auth/*       ── Auth routes
    │   ├── /courses/*    ── Course browsing
    │   ├── /admin/*      ── Admin operations
    │   ├── /api/progress/* ── Progress API
    │   └── /api/validate  ── Validation API (workshop + practical)
    │
    ├── Service Layer
    │   ├── course_parser.py     ── Filesystem scanner, front-matter, locks
    │   ├── assessment_parser.py ── Questions, steps, requirements parsing
    │   └── validator.py         ── 12 template functions, YAML rule loader
    │
    ├── Templates Directory
    │   ├── html_structure.yaml  ── 30+ HTML validation rules
    │   ├── css_rules.yaml       ── 19 CSS validation rules
    │   └── general_rules.yaml   ── 15 general validation rules
    │
    ├── Database (SQLAlchemy + SQLite)
    │   ├── User, Progress, Badge, UserBadge
    │   ├── ActivityLog, Ban, Certificate, CertificateTemplate
    │   └── course_structure.yaml (filesystem metadata overlay)
    │
    └── Response
        ├── Jinja2 Template → HTML + Tailwind + Vanilla JS
        └── JSON API (progress, badges, activity, streak, validation)
```

### Database Models

| Model | Table | Role |
|---|---|---|
| `User` | `users` | Auth, roles (student/instructor/admin), profile |
| `Progress` | `progress` | Per-user state per content item (step, score, verdict, submission) |
| `Badge` | `badges` | Badge definitions with type-specific JSON config |
| `UserBadge` | `user_badges` | Join table tracking awarded badges |
| `ActivityLog` | `activity_log` | Daily activity count for streaks + contribution graph |
| `Ban` | `bans` | User bans with optional expiry |
| `CertificateTemplate` | `certificate_templates` | Reusable certificate designs |
| `Certificate` | `certificates` | Awarded certificates linked to users |

### Key Decisions

- **Filesystem as course structure** — directories map to categories, files to content. `course_structure.yaml` overlays metadata (locks, prerequisites, custom titles) without duplicating the tree.
- **No JavaScript framework** — vanilla JS + Tailwind CDN keeps deployment simple and pages fast
- **Server-rendered HTML** — Jinja2 for SEO, instant first paint, and straightforward debugging
- **SQLite** — zero configuration, production-viable for single-server deployments; swap to PostgreSQL by changing `DATABASE_URL`

---

## 📋 Development Phases

| Phase | Focus | Status |
|---|---|---|
| **1 — Foundation** | Auth, course parser, card UI, lock/unlock logic | ✅ Complete |
| **2 — Assessment Engine** | Quiz/test/exam parser + UI, note embedding | ✅ Complete |
| **3 — Hands-on Workshop** | Step-by-step command validation with progress persistence | ✅ Complete |
| **4 — Practical Workshop** | Monaco editor, iframe live preview, requirement validation | ✅ Complete |
| **5 — Projects & Review** | Project submission, instructor verdict workflow | ✅ Complete |
| **6 — Profile & Achievements** | Profile, settings, badge system, certificates | ✅ Complete |
| **7 — Smart Validation** | Global validator library, YAML rules, Monaco editor, API endpoint | ✅ Complete |
| **8 — E2E Testing** | 41 E2E tests (745 total), 100% pass rate | ✅ Complete |

### Post-Phase Enhancements

| Enhancement | Status |
|---|---|
| Admin content management dashboard | ✅ |
| Badge system (5 award types, auto-award, manual award) | ✅ |
| Contribution graph + streak tracking | ✅ |
| Certificate templates + awarding | ✅ |
| User ban/unban management | ✅ |
| File/image upload | ✅ |
| Admin sidebar navigation | ✅ |
| Toast notification system | ✅ |
| Breadcrumb with sibling navigation | ✅ |
| Dark/light theme with CSS custom properties | ✅ |

---

## 🧪 Testing

**745 tests total — all passing.**

```bash
# Run everything
python3 test_production_e2e.py                    # 229 tests — full production suite

# Or run individual suites
python3 test_phase1.py                             # 36 — Foundation
python3 test_phase2.py                             # 47 — Assessment engine
python3 test_phase3_6.py                           # 29 — Workshops, projects, profile
python3 test_all.py                                # 86 — Combined phase suite
python3 test_badges_e2e.py                         # 60 — Badge system
python3 test_validator.py                          # 161 — Validator (12 templates, HTML/CSS parsing, YAML loading)
python3 test_phase3_4.py                           # 57 — Workshop + Practical API flow
python3 test_e2e_smart.py                          # 41 — E2E smart validation (HTML building, practical CSS, backward compat)
```

### What's tested

| Category | Coverage |
|---|---|
| **Authentication** | Registration, login, duplicate rejection, password change (wrong current, mismatch, too short), role enforcement, logout |
| **Authorization** | Student blocked from admin routes, admin session access, banned user redirect loop prevention |
| **Course Parser** | Directory scanning, front-matter with/without body, sort keys (single/multi-level), path-to-ID, name-to-title, prerequisite gating, date/pass/manual locks, parse_lock_value, breadcrumbs, structure capture/load/save |
| **Assessment Engine** | Type normalization (22 variants), question parsing (1–N questions, options, answer extraction), workshop steps, practical requirements with goals, empty/unknown types, mode detection, per-page config, min_errors |
| **Validation** | 12 template functions (tag_exists, tag_nested, css_property, regex, etc.), HTML tree builder (opening/closing/nesting/attributes/text/classes/ids), CSS parser (property extraction), YAML rule loading, inline rule parsing, legacy fallback |
| **Progress API** | GET (new + existing), save step, complete content, submit project, re-submit with verdict reset, unauthorized verdict (403) |
| **Admin API** | Capture, get/update structure, batch update, content preview/save, save missing body (400), save nonexistent (404), users list, ban/unban, submissions list + verdict, certificate templates CRUD (create, update, update nonexistent 404), award certificate, badges CRUD (all 8 types), toggle enable/disable, toggle nonexistent (404), manual award, duplicate award (409), award missing params (400) |
| **Badge System** | Streak detection (5-day), auto-award (all event types), disabled badge exclusion, manual award |
| **Contribution Graph** | Activity logging on completion, date format validity, 365-day boundary |
| **Database Integrity** | Unique email, unique username, unique activity log constraints |
| **Full User Journey** | Register → browse courses → view content → complete content → submit project → profile → dashboard → logout → re-login → verify badges + streak |
| **Static & Errors** | CSS served, JS served, 404 for unknown route |
| **Banned User** | Ban blocks session, unban restores access |
| **Edge Cases** | Nonexistent content ID, empty front matter, no front matter, invalid lock config, none/empty lock values, empty quiz body, note without questions, unknown content type |
| **E2E Smart Validation** | Full workshop HTML building flow (DOCTYPE → html → head → body → h1), practical CSS flow (font-size + text-align), backward compat (legacy expected + code.includes), performance (4000 validations, <1ms each), template loading |

---

## 📁 Project Structure

```
├── app/
│   ├── __init__.py                # App factory, blueprint registration, before_request
│   ├── models/
│   │   ├── user.py                # User model (auth, roles, profile, is_banned)
│   │   ├── progress.py            # Progress (step, score, verdict, submission)
│   │   ├── badge.py               # Badge, UserBadge, ActivityLog
│   │   └── admin.py               # Ban, Certificate, CertificateTemplate
│   ├── routes/
│   │   ├── auth.py                # register, login, logout, change-password
│   │   ├── main.py                # landing, dashboard, profile, settings, file upload
│   │   ├── courses.py             # course tree, content viewer, API tree, lock check
│   │   ├── progress_api.py        # progress CRUD, badges, activity, streak, verdict, validation API
│   │   └── admin.py               # admin dashboard, content, users, submissions, certs, badges
│   ├── services/
│   │   ├── course_parser.py       # filesystem scanner, front-matter, lock/unlock, structure I/O
│   │   ├── assessment_parser.py   # question/step/requirement/goal parser, type normalization
│   │   └── validator.py           # 12 template functions, HTML/CSS parsing, YAML rule loader
│   └── templates/
│       ├── base.html              # Layout with dark/light mode, nav, flash messages
│       ├── components/
│       │   ├── assessment.html    # Quiz/test/exam renderer
│       │   ├── workshop.html      # Step-by-step workshop renderer (Monaco editor)
│       │   ├── practical_workshop.html  # IDE layout (requirements + Monaco + preview)
│       │   ├── tree_item.html     # Course tree node
│       │   └── _admin_sidebar.html       # Admin navigation sidebar
│       └── pages/                 # Full page templates (16 pages)
├── templates/                     # Validation rules (YAML files, loaded at startup)
│   ├── html_structure.yaml        # 30+ HTML validation rules
│   ├── css_rules.yaml             # 19 CSS validation rules
│   └── general_rules.yaml         # 15 general validation rules
├── courses/
│   ├── course_structure.yaml      # Metadata overlay for course content
│   └── 1. Foundation Introduction/ # Sample course content
├── static/
│   ├── css/style.css              # Custom styles (prose, layout, components)
│   ├── js/main.js                 # Assessment, workshop, practical workshop components
│   └── favicon.svg                # Brand icon
├── instance/                      # SQLite DB + session files (gitignored)
├── upload/                        # User-uploaded files (gitignored)
├── migrations/                    # Alembic migration scripts
├── config.py                      # Configuration from environment variables
├── run.py                         # Application entry point
├── requirements.txt               # Python package dependencies
├── GUIDE.md                       # Full content authoring guide
├── README.md                      # This file
├── Design.md                      # Smart validation system design doc
├── TODO.md                        # 8-phase task breakdown
├── test_production_e2e.py         # 229-test production readiness suite
├── test_phase1.py                 # Phase 1 foundation tests
├── test_phase2.py                 # Phase 2 assessment engine tests
├── test_phase3_6.py               # Phases 3–6 tests
├── test_all.py                    # Combined phase suite
├── test_badges_e2e.py             # Badge system end-to-end tests
├── test_validator.py              # 161 tests — Validator (templates, HTML, CSS, YAML)
├── test_phase3_4.py               # 57 tests — Workshop + Practical API flow
└── test_e2e_smart.py              # 41 tests — E2E smart validation
```

---

<br/>
<div align="center">
  <table>
    <tr>
      <td align="center">
        <a href="https://github.com/nexuss0781/Digital-Edu">
          <img src="https://img.shields.io/badge/GitHub-nexuss0781%2FDigital--Edu-%23001A49?logo=github" alt="GitHub"/>
        </a>
      </td>
      <td align="center">
        <a href="https://ethcocoders.gt.tc">
          <img src="https://img.shields.io/badge/Built%20by-Ethco%20Coders-%2300B4FC" alt="Ethco Coders"/>
        </a>
      </td>
    </tr>
  </table>
  <br/>
  <sub>
    <strong>DigitalEdu</strong> — Competency-Based Learning Platform<br/>
    Built with ❤️ by the <strong>DigitalEdu Team</strong> at <a href="https://ethcocoders.gt.tc">Ethco Coders</a>
  </sub>
  <br/>
  <sub>© 2026 Ethco Coders. MIT licensed.</sub>
</div>
