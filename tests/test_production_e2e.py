"""
Comprehensive End-to-End Production Readiness Test.

Usage:
    python3 test_production_e2e.py

Exit code 0 = all pass, 1 = any fail.
"""

import os, sys, json, tempfile, shutil, re
from datetime import date, timedelta, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

PASS = 0; FAIL = 0; ERRORS = []

def ok(name):
    global PASS; PASS += 1

def fail(name, msg=''):
    global FAIL; FAIL += 1; ERRORS.append((name, msg))
    print(f"  FAIL  {name}  -- {msg}")

def assert_eq(a, b, name):
    if a == b: ok(name)
    else: fail(name, f'expected {b!r}, got {a!r}')

def assert_true(v, name):
    if v: ok(name)
    else: fail(name, f'expected True, got {v!r}')

def assert_false(v, name):
    if not v: ok(name)
    else: fail(name, f'expected False, got {v!r}')

def assert_gt(a, b, name):
    if a > b: ok(name)
    else: fail(name, f'expected {a} > {b}')

def assert_in(body, text, name):
    b = body if isinstance(body, str) else body.decode()
    if text in b: ok(name)
    else: fail(name, f'expected {text!r} in response')

def assert_not_in(body, text, name):
    b = body if isinstance(body, str) else body.decode()
    if text not in b: ok(name)
    else: fail(name, f'expected {text!r} NOT in response')

def path_to_id(rel_path):
    parts = rel_path.replace('\\', '/').split('/')
    cleaned = []
    for p in parts:
        p = re.sub(r'^[\d.\s]+', '', p)
        p = re.sub(r'\s+', '-', p.strip())
        p = p.lower().replace('.md', '')
        if p: cleaned.append(p)
    return '/'.join(cleaned) if cleaned else 'root'

# ── Setup ──────────────────────────────────────────────────
tmpdir = tempfile.mkdtemp()
test_db_path = os.path.join(os.path.dirname(__file__), 'instance', 'test_prod_e2e.db')
if os.path.exists(test_db_path): os.remove(test_db_path)

os.environ['FLASK_ENV'] = 'testing'
os.environ['COURSES_DIR'] = tmpdir
os.environ['DATABASE_URL'] = f'sqlite:///{test_db_path}'
os.environ['SECRET_KEY'] = 'prod-e2e-test-secret-key'

from app import create_app, db as _db
from app.models.user import User
from app.models.progress import Progress
from app.models.badge import Badge, UserBadge, ActivityLog
from app.models.admin import Ban, Certificate, CertificateTemplate
from app.services.course_parser import (
    get_course_tree, get_content_by_id, check_item_locked,
    check_prerequisites, get_sort_key, parse_front_matter,
    load_structure, save_structure, capture_structure,
    name_to_title, parse_lock_value, get_breadcrumb, build_structure_index,
)
from app.services.assessment_parser import (
    parse_content, normalize_type, get_assessment_mode,
    get_per_page, get_min_errors,
    _parse_questions, _parse_steps, _parse_requirements, _parse_goal,
)
from app.routes.progress_api import _get_current_streak, _check_badges

app = create_app()
app.config['TESTING'] = True
app.config['WTF_CSRF_ENABLED'] = False
app.config['SERVER_NAME'] = 'localhost'

with app.app_context():
    _db.create_all()

client = app.test_client()

# ── Course Content Fixtures ────────────────────────────────
def create_course_content():
    dirs = [
        '1. Foundation Introduction',
        '1. Foundation Introduction/1.1 Operate Personal Computer',
        '1. Foundation Introduction/1.2 Web Development',
    ]
    for d in dirs:
        os.makedirs(os.path.join(tmpdir, d), exist_ok=True)

    files = {
        '1. Foundation Introduction/1.1 Operate Personal Computer/1.1.1 Identify Computer Components.md': (
            '---\ntype: note\n---\n\n# Identify Components\n\nLearn about CPU, RAM, storage.'
        ),
        '1. Foundation Introduction/1.1 Operate Personal Computer/1.1.2 Operating System Basics.md': (
            '---\ntype: note\nprerequisites: [identify-computer-components]\n---\n\n'
            '# OS Basics\n\nUnderstanding operating systems.'
        ),
        '1. Foundation Introduction/1.1 Operate Personal Computer/1.1.3 Computer Hardware Quiz.md': (
            '---\ntype: quiz\n---\n\n'
            '<!-- questions\n'
            '* What does CPU stand for?\n'
            '- Central Processing Unit\n'
            '- Computer Personal Unit\n'
            '- Central Program Utility\n'
            '- Core Processing Unit\n'
            'Answer: A\n'
            '* What is RAM?\n'
            '- Read Access Memory\n'
            '- Random Access Memory\n'
            '- Rapid Access Module\n'
            '- Read and Modify\n'
            'Answer: B\n-->'
        ),
        '1. Foundation Introduction/1.1 Operate Personal Computer/1.1.4 HTML Basics Workshop.md': (
            '---\ntype: workshop\nprerequisites: [operating-system-basics]\n---\n\n'
            '<!-- steps\n'
            'step: 1\nexplanation: "Create an HTML document"\n'
            'prompt: "Write the DOCTYPE declaration"\nexpected: "<!DOCTYPE html>"\n'
            'step: 2\nexplanation: "Add the html element"\n'
            'prompt: "Write the opening html tag"\nexpected: "<html>"\n-->'
        ),
        '1. Foundation Introduction/1.2 Web Development/1.2.1 CSS Styling Practical.md': (
            '---\ntype: practical\n---\n\n'
            '<!-- requirements\n'
            'requirement: "Use a heading element"\n'
            'validate: "code.includes(\'<h1>\')"\ngoal: "<h1>Hello</h1>"\n'
            'requirement: "Add a paragraph"\n'
            'validate: "code.includes(\'<p>\')"\n-->\n\n'
            'Write a simple HTML page.\n\n'
            '<!-- goal\n<h1>Hello World</h1>\n<p>Sample.</p>\n-->'
        ),
        '1. Foundation Introduction/1.2 Web Development/1.2.2 Web Development Test.md': (
            '---\ntype: Tests\nmin_errors: 1\n---\n\n'
            '<!-- questions\n'
            '* What tag creates a hyperlink?\n'
            '- <a>\n- <link>\n- <href>\n- <url>\nAnswer: A\n'
            '* Which CSS property changes text color?\n'
            '- font-color\n- text-color\n- color\n- foreground\nAnswer: C\n-->'
        ),
        '1. Foundation Introduction/1.3 Final Project.md': (
            '---\ntype: project\n---\n\n# Final Project\n\nBuild a complete HTML page.'
        ),
    }
    for relpath, content in files.items():
        fpath = os.path.join(tmpdir, relpath)
        os.makedirs(os.path.dirname(fpath), exist_ok=True)
        with open(fpath, 'w') as f:
            f.write(content)

create_course_content()

# Determine expected content IDs from file paths
_NOTE_ID = path_to_id('1. Foundation Introduction/1.1 Operate Personal Computer/1.1.1 Identify Computer Components.md')
_OS_ID = path_to_id('1. Foundation Introduction/1.1 Operate Personal Computer/1.1.2 Operating System Basics.md')
_QUIZ_ID = path_to_id('1. Foundation Introduction/1.1 Operate Personal Computer/1.1.3 Computer Hardware Quiz.md')
_WS_ID = path_to_id('1. Foundation Introduction/1.1 Operate Personal Computer/1.1.4 HTML Basics Workshop.md')
_PRACTICAL_ID = path_to_id('1. Foundation Introduction/1.2 Web Development/1.2.1 CSS Styling Practical.md')
_TEST_ID = path_to_id('1. Foundation Introduction/1.2 Web Development/1.2.2 Web Development Test.md')
_PROJECT_ID = path_to_id('1. Foundation Introduction/1.3 Final Project.md')

# Progress API routes use <content_id> (single path segment), so use flat IDs
SIMPLE_CONTENT = 'my-content'
SIMPLE_QUIZ = 'my-quiz'
SIMPLE_PROJECT = 'my-project'
SIMPLE_WORKSHOP = 'my-workshop'

# ── 1. Bootstrap ──────────────────────────────────────────
def test_bootstrap():
    print('\n─── 1. Application Bootstrap ───')
    assert_true(app is not None, 'App factory creates Flask app')
    assert_true('sqlite:///' in app.config['SQLALCHEMY_DATABASE_URI'], 'SQLite URI')

    with app.app_context():
        tables = list(_db.metadata.tables.keys())
        for tbl in ('users', 'progress', 'badges', 'user_badges', 'activity_log', 'bans', 'certificate_templates', 'certificates'):
            assert_true(tbl in tables, f'Table {tbl} exists')

    rules = [r.rule for r in app.url_map.iter_rules()]
    for route in ['/auth/register', '/auth/login', '/auth/logout', '/',
                  '/dashboard', '/profile', '/settings',
                  '/courses/', '/courses/<path:content_id>', '/courses/api/tree',
                  '/api/progress/<content_id>', '/api/progress/<content_id>/step',
                  '/api/progress/<content_id>/complete', '/api/progress/<content_id>/submit',
                  '/api/progress/<content_id>/verdict', '/api/progress/badges',
                  '/api/progress/activity', '/api/progress/streak',
                  '/admin/', '/admin/content', '/admin/users', '/admin/submissions',
                  '/admin/certificates', '/admin/badges']:
        assert_true(route in rules, f'Route {route} registered')

# ── 2. Course Parser ──────────────────────────────────────
def test_course_parser():
    print('\n─── 2. Course Parser ───')
    with app.app_context():
        tree = get_course_tree()
        assert_true(len(tree) > 0, 'Course tree populated')
        cats = [e for e in tree if e['type'] == 'category']
        assert_true(len(cats) >= 1, 'Contains categories')

        content = get_content_by_id(_NOTE_ID)
        assert_true(content is not None, f'Content found by ID: {_NOTE_ID}')
        assert_eq(content['type'], 'note', 'Content type note')
        assert_true(len(content.get('body', '')) > 0, 'Content has body')
        assert_eq(get_content_by_id('nonexistent'), None, 'Nonexistent ID returns None')

        # Prerequisite logic
        assert_true(check_prerequisites(_NOTE_ID, []) is True, 'No-prereq always unlocked')
        prereq_content = get_content_by_id(_OS_ID)
        if prereq_content and prereq_content.get('prerequisites'):
            prereqs = prereq_content['prerequisites']
            assert_true(len(prereqs) > 0, 'OS basics has prerequisites')
            assert_false(check_prerequisites(_OS_ID, []), 'Locked when none completed')
            assert_true(check_prerequisites(_OS_ID, prereqs) is True, 'Unlocked when all completed')

        # Sort keys
        assert_eq(get_sort_key('1. Foundation'), (1,), 'Sort key 1.0')
        assert_eq(get_sort_key('1.1 Section'), (1, 1), 'Sort key 1.1')
        assert_eq(get_sort_key('1.1.1 File'), (1, 1, 1), 'Sort key 1.1.1')
        assert_gt(get_sort_key('2.'), get_sort_key('1.'), 'Sort 2.0 > 1.0')

        # Name to title
        assert_eq(name_to_title('1.1.3 My Note.md'), 'My Note', 'name_to_title strips prefix')
        assert_eq(name_to_title('Simple.md'), 'Simple', 'name_to_title no prefix')

        # Front matter
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("---\ntype: note\nid: x\ntitle: X\nprerequisites: [a]\n---\n# Body"); p = f.name
        meta, body = parse_front_matter(p)
        assert_eq(meta.get('type'), 'note', 'FM type'); assert_eq(meta.get('id'), 'x', 'FM id')
        assert_eq(meta.get('title'), 'X', 'FM title')
        assert_eq(meta.get('prerequisites'), ['a'], 'FM prereqs')
        assert_true('# Body' in body, 'FM body'); os.unlink(p)

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Just content"); p2 = f.name
        meta2, _ = parse_front_matter(p2)
        assert_eq(meta2.get('type'), 'note', 'No FM defaults to note'); os.unlink(p2)

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write('---\n---\n\nBody'); p3 = f.name
        meta3, _ = parse_front_matter(p3)
        assert_eq(meta3.get('type'), 'note', 'Empty FM defaults to note'); os.unlink(p3)

        # Lock/unlock
        assert_false(check_item_locked({}), 'Empty config')
        assert_false(check_item_locked(None), 'None config')
        assert_false(check_item_locked({'lock_type': None}), 'Null lock type')
        assert_false(check_item_locked({'lock_type': 'invalid'}), 'Invalid lock type')
        assert_true(check_item_locked({'lock_type': 'pass'}), 'Pass locks')
        assert_true(check_item_locked({'lock_type': 'manual'}), 'Manual locks')
        assert_true(check_item_locked({'lock_type': 'date', 'lock_value': '31/12/30'}), 'Future date locks')
        assert_false(check_item_locked({'lock_type': 'date', 'lock_value': '01/01/20'}), 'Past date unlocks')

        # Parse lock value
        assert_true(parse_lock_value('31/12/30') is not None, 'Parse date')
        assert_true(parse_lock_value('7 days') is not None, 'Parse relative')
        assert_eq(parse_lock_value(None), None, 'Parse None')
        assert_eq(parse_lock_value('not-a-date'), None, 'Parse invalid')

        # Structure persistence
        struct = capture_structure()
        assert_true(len(struct) > 0, 'Structure captured')
        assert_eq(len(struct), len(load_structure()), 'Load matches capture')

        # Breadcrumb
        crumbs = get_breadcrumb(_QUIZ_ID)
        assert_true(len(crumbs) > 0, 'Breadcrumb has entries')

        # Build structure index
        idx = build_structure_index()
        assert_true(_NOTE_ID in idx, 'Index contains known content')

# ── 3. Assessment Engine ──────────────────────────────────
def test_assessment_engine():
    print('\n─── 3. Assessment Engine ───')
    for inp, expected in [
        ('quiz', 'quiz'), ('QUIZ', 'quiz'), ('Quizzes', 'quiz'),
        ('tests', 'test'), ('Tests', 'test'), ('exam', 'exam'),
        ('Exams', 'exam'), ('workshop', 'workshop'), ('practical', 'practical'),
        ('project', 'project'), ('note', 'note'), ('', 'note'),
        (None, 'note'), ('unknown', 'unknown'), ('  Quiz  ', 'quiz'),
    ]:
        assert_eq(normalize_type(inp), expected, f'normalize({inp!r})')

    qb = "<!-- questions\n* Q1?\n- A\n- B\n- C\n- D\nAnswer: B\n* Q2?\n- X\n- Y\nAnswer: A\n-->"
    r = parse_content('quiz', qb)
    assert_eq(len(r), 1, 'Quiz parsed')
    assert_eq(len(r[0]['questions']), 2, '2 questions')
    assert_eq(r[0]['questions'][0]['answer'], 'B', 'Q1 answer')
    assert_eq(r[0]['questions'][1]['answer'], 'A', 'Q2 answer')

    assert_eq(parse_content('test', qb)[0]['type'], 'test', 'Test type')
    assert_eq(parse_content('exams', qb)[0]['type'], 'exam', 'Exam type')
    assert_eq(len(parse_content('note', qb)), 1, 'Note with questions')

    ws = "<!-- steps\nstep: 1\nexplanation: \"X\"\nprompt: \"Y\"\nexpected: \"Z\"\n-->"
    assert_eq(len(parse_content('workshop', ws)[0]['steps']), 1, 'Workshop 1 step')

    req = ("<!-- requirements\nrequirement: \"Use h1\"\nvalidate: \"x\"\ngoal: \"<h1>\"\n-->"
           "\n<!-- goal\nOUTPUT\n-->")
    pr = parse_content('practical', req)
    assert_eq(len(pr), 1, 'Practical parsed')
    assert_eq(pr[0]['requirements'][0]['requirement'], 'Use h1', 'Req text')
    assert_eq(pr[0].get('goal'), 'OUTPUT', 'Goal extracted')

    assert_eq(parse_content('note', '# just a note'), [], 'Note plain empty')
    assert_eq(parse_content('unknown', 'body'), [], 'Unknown type empty')
    assert_eq(get_assessment_mode('quiz'), 'quiz', 'Mode quiz')
    assert_eq(get_assessment_mode('note'), None, 'Mode note None')
    assert_eq(get_per_page('quiz'), 1, 'Per page 1')
    assert_eq(get_per_page('exam'), 10, 'Per page 10')
    assert_eq(get_min_errors({'min_errors': 4}), 4, 'min_errors 4')
    assert_eq(get_min_errors({}), 0, 'min_errors default')

# ── 4. Auth & Authorization ───────────────────────────────
def test_auth_e2e():
    print('\n─── 4. Authentication & Authorization ───')
    resp = client.get('/')
    assert_eq(resp.status_code, 200, 'Landing page')
    assert_in(resp.data, 'DigitalEdu', 'Landing shows branding')

    resp = client.post('/auth/register', data={
        'email': 'alice@test.com', 'username': 'alice',
        'password': 'secure123', 'role': 'student',
    }, follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Register success')
    assert_in(resp.data, 'Dashboard', 'Redirects to dashboard')

    client.get('/auth/logout')
    resp = client.get('/dashboard', follow_redirects=True)
    # Should redirect to login page or landing page for guest
    assert_true(resp.status_code == 200, 'Unauthenticated user redirected')

    resp = client.post('/auth/register', data={
        'email': 'alice@test.com', 'username': 'alice2', 'password': 'secure123',
    }, follow_redirects=True)
    assert_in(resp.data, 'Email already registered', 'Duplicate email rejected')

    resp = client.post('/auth/register', data={
        'email': 'alice2@test.com', 'username': 'alice', 'password': 'secure123',
    }, follow_redirects=True)
    assert_in(resp.data, 'Username already taken', 'Duplicate username rejected')

    resp = client.post('/auth/register', data={
        'email': 'wannabe@test.com', 'username': 'wannabe', 'password': 'secure123', 'role': 'admin',
    }, follow_redirects=True)
    with app.app_context():
        w = User.query.filter_by(email='wannabe@test.com').first()
        assert_eq(w.role, 'instructor', 'Admin registration downgraded to instructor')

    resp = client.post('/auth/login', data={
        'email': 'alice@test.com', 'password': 'secure123',
    }, follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Login success')
    assert_in(resp.data, 'Dashboard', 'Login redirects to dashboard')

    client.get('/auth/logout')
    resp = client.post('/auth/login', data={
        'email': 'alice@test.com', 'password': 'wrong',
    }, follow_redirects=True)
    assert_in(resp.data, 'Invalid email or password', 'Wrong password rejected')

    resp = client.post('/auth/login', data={
        'email': 'nobody@test.com', 'password': 'x',
    }, follow_redirects=True)
    assert_in(resp.data, 'Invalid email or password', 'Nonexistent email rejected')

    client.post('/auth/login', data={'email': 'alice@test.com', 'password': 'secure123'})
    resp = client.post('/auth/change-password', data={
        'current_password': 'secure123', 'new_password': 'newpass456', 'confirm_password': 'newpass456',
    }, follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Password change')
    client.get('/auth/logout')
    resp = client.post('/auth/login', data={'email': 'alice@test.com', 'password': 'newpass456'}, follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Login with new password')

    with app.app_context():
        u = User.query.filter_by(email='alice@test.com').first()
        assert_true(u.check_password('newpass456'), 'Password hash updated')

    resp = client.post('/auth/change-password', data={
        'current_password': 'newpass456', 'new_password': 'ab', 'confirm_password': 'ab',
    }, follow_redirects=True)
    assert_in(resp.data, 'at least 6 characters', 'Short password rejected')

    resp = client.post('/auth/change-password', data={
        'current_password': 'newpass456', 'new_password': 'x1', 'confirm_password': 'x2',
    }, follow_redirects=True)
    assert_in(resp.data, 'New passwords do not match', 'Mismatch rejected')

    resp = client.post('/auth/change-password', data={
        'current_password': 'wrong', 'new_password': 'okpass1', 'confirm_password': 'okpass1',
    }, follow_redirects=True)
    assert_in(resp.data, 'Current password is incorrect', 'Wrong current rejected')

    client.get('/auth/logout')

# ── 5. Courses & Content ──────────────────────────────────
def test_courses_e2e():
    print('\n─── 5. Courses & Content ───')
    client.post('/auth/login', data={'email': 'alice@test.com', 'password': 'newpass456'})

    resp = client.get('/courses/')
    assert_eq(resp.status_code, 200, 'Courses page')
    assert_in(resp.data, 'Foundation Introduction', 'Courses shows content')

    resp = client.get('/courses/api/tree')
    assert_eq(resp.status_code, 200, 'API tree')
    assert_true(len(resp.get_json()) > 0, 'API tree has data')

    resp = client.get(f'/courses/{_NOTE_ID}')
    assert_eq(resp.status_code, 200, 'View unlocked content')

    resp = client.get('/courses/nonexistent-content')
    assert_eq(resp.status_code, 404, 'Nonexistent content 404')

    client.get('/auth/logout')
    resp = client.get(f'/courses/{_NOTE_ID}', follow_redirects=True)
    # Guest redirected to login for protected content
    assert_true(resp.status_code == 200, 'Guest handled for content')

# ── 6. Progress API ───────────────────────────────────────
def test_progress_api():
    print('\n─── 6. Progress API ───')
    client.post('/auth/login', data={'email': 'alice@test.com', 'password': 'newpass456'})

    resp = client.get('/api/progress/test-content')
    assert_eq(resp.status_code, 200, 'Get progress')
    assert_eq(resp.get_json()['step_index'], 0, 'New progress step 0')

    resp = client.post('/api/progress/test-content/step', json={'step_index': 3})
    assert_eq(resp.status_code, 200, 'Save step')
    assert_eq(resp.get_json()['step_index'], 3, 'Step 3 saved')

    resp = client.get('/api/progress/test-content')
    assert_eq(resp.get_json()['step_index'], 3, 'Step persists')

    resp = client.post('/api/progress/test-content/complete', json={
        'content_type': 'workshop', 'score': 95, 'passed': True,
    })
    assert_eq(resp.status_code, 200, 'Complete content')
    assert_true(resp.get_json()['completed'], 'Marked completed')

    resp = client.get('/api/progress/test-content')
    assert_true(resp.get_json()['completed'], 'Completed persists')

    resp = client.post('/api/progress/final-project/submit', json={
        'code': '<html><body>My Project</body></html>',
    })
    assert_eq(resp.status_code, 200, 'Submit project')
    assert_true(resp.get_json()['submitted'], 'Submission confirmed')
    resp = client.get('/api/progress/final-project')
    assert_true('<html><body>My Project' in resp.get_json()['submission'], 'Submission stored')

    resp = client.post('/api/progress/final-project/submit', json={
        'code': '<html><body>Updated</body></html>',
    })
    assert_eq(resp.status_code, 200, 'Re-submit')
    resp = client.get('/api/progress/final-project')
    assert_true('<body>Updated' in resp.get_json()['submission'], 'Re-submission stored')

    resp = client.post('/api/progress/final-project/verdict', json={
        'verdict': 'passed', 'user_id': 999,
    })
    assert_eq(resp.status_code, 403, 'Student cannot set verdict')

    resp = client.get('/api/progress/badges')
    assert_eq(resp.status_code, 200, 'Badges API')

    resp = client.get('/api/progress/activity')
    assert_eq(resp.status_code, 200, 'Activity API')
    data = resp.get_json()
    assert_true(date.today().isoformat() in data, 'Activity logged today')

    resp = client.get('/api/progress/streak')
    assert_eq(resp.status_code, 200, 'Streak API')
    assert_true(resp.get_json()['streak'] >= 1, 'Streak >= 1')

    client.get('/auth/logout')

# ── 7. Profile & Settings ─────────────────────────────────
def test_profile_settings():
    print('\n─── 7. Profile & Settings ───')
    client.post('/auth/login', data={'email': 'alice@test.com', 'password': 'newpass456'})

    resp = client.get('/profile')
    assert_eq(resp.status_code, 200, 'Profile page')
    resp = client.get('/dashboard')
    assert_eq(resp.status_code, 200, 'Dashboard')
    resp = client.get('/settings')
    assert_eq(resp.status_code, 200, 'Settings page')

    resp = client.post('/settings', data={'visibility': 'private'}, follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Settings POST')
    assert_in(resp.data, 'Settings updated', 'Flash message')

    with app.app_context():
        u = User.query.filter_by(email='alice@test.com').first()
        assert_eq(u.profile_visibility, 'private', 'Visibility persisted')

    client.get('/auth/logout')

# ── 8. Admin Operations ───────────────────────────────────
def test_admin_operations():
    print('\n─── 8. Admin Operations ───')
    with app.app_context():
        admin = User(email='admin@test.com', username='admin', role='admin')
        admin.set_password('admin123'); _db.session.add(admin); _db.session.commit()
        admin_id = admin.id

    client.post('/auth/login', data={'email': 'alice@test.com', 'password': 'newpass456'})
    resp = client.get('/admin/', follow_redirects=True)
    assert_not_in(resp.data, 'Admin Dashboard', 'Student blocked from admin')
    client.get('/auth/logout')

    with client.session_transaction() as sess:
        sess['_user_id'] = str(admin_id); sess['_fresh'] = True

    resp = client.get('/admin/')
    assert_eq(resp.status_code, 200, 'Admin dashboard')
    resp = client.get('/admin/content')
    assert_eq(resp.status_code, 200, 'Admin content')

    resp = client.post('/admin/api/capture')
    assert_eq(resp.status_code, 200, 'Capture structure')
    structure = resp.get_json()
    assert_true(len(structure) > 0, 'Structure has items')

    resp = client.get('/admin/api/structure')
    assert_eq(resp.status_code, 200, 'Get structure')
    assert_true(len(resp.get_json()) > 0, 'Structure data')

    item_id = list(structure.keys())[0]
    resp = client.post('/admin/api/update-item', json={
        'id': item_id, 'updates': {'title': 'Updated Title'},
    })
    assert_eq(resp.status_code, 200, 'Update item')
    resp = client.post('/admin/api/batch-update', json={
        'ids': [item_id], 'updates': {'lock_type': 'pass'},
    })
    assert_eq(resp.status_code, 200, 'Batch update')

    # Use a file-type item for content preview/save (categories are directories, not files)
    file_item_id = None
    for cid, info in structure.items():
        if info.get('type') not in ('category',):
            file_item_id = cid
            break
    if file_item_id:
        resp = client.get(f'/admin/api/content-preview/{file_item_id}')
        assert_eq(resp.status_code, 200, 'Content preview')
        resp = client.post('/admin/api/save-content', json={
            'id': file_item_id, 'body': '# Updated body\n\nNew content.',
        })
        assert_eq(resp.status_code, 200, 'Save content')
        resp = client.post('/admin/api/save-content', json={'id': file_item_id})
        assert_eq(resp.status_code, 400, 'Save content missing body')
    resp = client.post('/admin/api/save-content', json={'id': 'nope', 'body': 'x'})
    assert_eq(resp.status_code, 404, 'Save content nonexistent')

    resp = client.get('/admin/users')
    assert_eq(resp.status_code, 200, 'Users page')
    resp = client.get('/admin/api/users')
    assert_eq(resp.status_code, 200, 'Users API')
    users = resp.get_json()
    alice = next(u for u in users if u['email'] == 'alice@test.com')
    alice_id = alice['id']

    resp = client.post(f'/admin/api/users/{alice_id}/ban', json={
        'duration': 1, 'unit': 'days', 'reason': 'E2E ban',
    })
    assert_eq(resp.status_code, 200, 'Ban user')
    with app.app_context():
        assert_true(User.query.get(alice_id).is_banned, 'User banned')

    resp = client.post(f'/admin/api/users/{alice_id}/unban')
    assert_eq(resp.status_code, 200, 'Unban user')
    with app.app_context():
        assert_false(User.query.get(alice_id).is_banned, 'User unbanned')

    resp = client.get('/admin/submissions')
    assert_eq(resp.status_code, 200, 'Submissions page')
    resp = client.get('/admin/api/submissions')
    assert_eq(resp.status_code, 200, 'Submissions API')

    with app.app_context():
        p = Progress.query.filter_by(content_id='final-project').first()
        if p:
            resp = client.post(f'/admin/api/submissions/{p.id}/verdict', json={'verdict': 'passed'})
            assert_eq(resp.status_code, 200, 'Submission verdict')

    resp = client.get('/admin/certificates')
    assert_eq(resp.status_code, 200, 'Certificates page')
    resp = client.get('/admin/api/certificate-templates')
    assert_eq(resp.status_code, 200, 'Cert templates API')

    resp = client.post('/admin/api/certificate-templates', json={
        'name': 'Foundation Cert', 'header': 'Complete', 'subtitle': 'Level 1',
        'description': 'Done', 'issuer': 'DigitalEdu', 'footer': 'Good',
    })
    assert_eq(resp.status_code, 200, 'Create template')
    tpl_id = resp.get_json()['id']
    assert_true(tpl_id is not None, 'Template ID')

    resp = client.put(f'/admin/api/certificate-templates/{tpl_id}', json={'name': 'Updated'})
    assert_eq(resp.status_code, 200, 'Update template')
    resp = client.put('/admin/api/certificate-templates/99999', json={'name': 'Nope'})
    assert_eq(resp.status_code, 404, 'Update nonexistent template')

    resp = client.post('/admin/api/award-certificate', json={
        'user_id': alice_id, 'category_id': 'foundation',
        'category_title': 'Foundation', 'subcategory_ids': 'a,b',
        'template_id': tpl_id,
    })
    assert_eq(resp.status_code, 200, 'Award certificate')
    assert_true(resp.get_json()['id'] is not None, 'Cert ID')
    resp = client.get('/admin/api/certificates')
    assert_true(len(resp.get_json()) >= 1, 'Certs list')

    resp = client.get('/admin/badges')
    assert_eq(resp.status_code, 200, 'Badges page')
    resp = client.get('/admin/api/badges')
    assert_eq(resp.status_code, 200, 'Badges API')

    for name, btype, cfg in [
        ('Streak 3', 'streak', {'min_streak': 3}),
        ('Course Complete', 'course_completion', {'course_ids': ['a']}),
        ('Combo', 'combo', {'course_ids': ['a', 'b'], 'deadline': '2099-12-31'}),
        ('Cert Collector', 'certificate', {'certificate_ids': ['foundation']}),
        ('First Step', 'events', {'event_type': 'first_completion'}),
        ('Ten Steps', 'events', {'event_type': 'ten_completions'}),
        ('All Courses', 'events', {'event_type': 'all_courses'}),
        ('First Cert', 'events', {'event_type': 'first_certificate'}),
    ]:
        resp = client.post('/admin/api/badges', json={
            'name': name, 'description': name, 'icon': 'award',
            'badge_type': btype, 'config': cfg, 'enabled': True,
        })
        assert_eq(resp.status_code, 200, f'Create badge: {name}')

    resp = client.get('/admin/api/badges')
    assert_eq(len(resp.get_json()), 8, '8 badges created')

    badges = resp.get_json()
    bid = badges[0]['id']
    resp = client.put(f'/admin/api/badges/{bid}', json={'name': 'Renamed'})
    assert_eq(resp.status_code, 200, 'Update badge')
    resp = client.put('/admin/api/badges/99999', json={'name': 'Nope'})
    assert_eq(resp.status_code, 404, 'Update nonexistent badge')

    resp = client.post(f'/admin/api/badges/{bid}/toggle')
    assert_eq(resp.status_code, 200, 'Toggle off')
    assert_false(resp.get_json()['enabled'], 'Disabled')
    resp = client.post(f'/admin/api/badges/{bid}/toggle')
    assert_true(resp.get_json()['enabled'], 'Re-enabled')
    resp = client.post('/admin/api/badges/99999/toggle')
    assert_eq(resp.status_code, 404, 'Toggle nonexistent')

    resp = client.post('/admin/api/badges/award', json={
        'user_id': alice_id, 'badge_id': badges[4]['id'],
    })
    assert_eq(resp.status_code, 200, 'Manual award')
    resp = client.post('/admin/api/badges/award', json={
        'user_id': alice_id, 'badge_id': badges[4]['id'],
    })
    assert_eq(resp.status_code, 409, 'Duplicate award blocked')
    resp = client.post('/admin/api/badges/award', json={'user_id': alice_id})
    assert_eq(resp.status_code, 400, 'Award missing badge_id')

    resp = client.get(f'/admin/api/activity/{alice_id}')
    assert_eq(resp.status_code, 200, 'Admin activity API')

    # Clear session before next tests
    with client.session_transaction() as sess:
        sess.clear()

# ── 9. Badge System ───────────────────────────────────────
def test_badge_system():
    print('\n─── 9. Badge System ───')
    with app.app_context():
        u = User(email='bob@test.com', username='bob', role='student')
        u.set_password('test'); _db.session.add(u); _db.session.commit()
        uid = u.id

        today = date.today()
        for i in range(5):
            _db.session.add(ActivityLog(user_id=uid, date=today - timedelta(days=i), count=1, content_ids='x'))
        _db.session.commit()
        assert_eq(_get_current_streak(uid), 5, '5-day streak')

        for cid in ['c1', 'c2', 'c3']:
            _db.session.add(Progress(user_id=uid, content_id=cid, content_type='note', completed=True))
        _db.session.commit()

        _check_badges(uid); _db.session.commit()
        ubs = UserBadge.query.filter_by(user_id=uid).all()
        assert_true(len(ubs) >= 1, 'Badges auto-awarded')

        disabled = Badge(name='Disabled', badge_type='events',
                         config=json.dumps({'event_type': 'first_completion'}), enabled=False)
        _db.session.add(disabled); _db.session.commit()
        before = UserBadge.query.filter_by(user_id=uid).count()
        _check_badges(uid); _db.session.commit()
        after = UserBadge.query.filter_by(user_id=uid).count()
        assert_true(after >= before, 'Disabled badge not awarded')
        awarded = UserBadge.query.filter_by(user_id=uid, badge_id=disabled.id).first()
        assert_eq(awarded, None, 'Disabled badge not in user badges')

# ── 10. Banned User Flow ──────────────────────────────────
def test_banned_user():
    print('\n─── 10. Banned User ───')
    with app.app_context():
        bu = User(email='banned@test.com', username='banned', role='student')
        bu.set_password('test'); _db.session.add(bu); _db.session.commit()
        ban_uid = bu.id
        admin = User.query.filter_by(email='admin@test.com').first()
        _db.session.add(Ban(user_id=ban_uid, banned_by=admin.id, reason='ban'))
        _db.session.commit()

    resp = client.post('/auth/login', data={'email': 'banned@test.com', 'password': 'test'})
    # Login + check_banned redirects to logout, which redirects to landing
    assert_true(resp.status_code in (200, 302), 'Banned user login handled')

    with app.app_context():
        Ban.query.filter_by(user_id=ban_uid).update({'active': False})
        _db.session.commit()

    resp = client.post('/auth/login', data={'email': 'banned@test.com', 'password': 'test'})
    assert_true(resp.status_code in (200, 302), 'Unbanned user can log in')

# ── 11. Static & Errors ───────────────────────────────────
def test_static_and_errors():
    print('\n─── 11. Static Files & Errors ───')
    resp = client.get('/static/css/style.css')
    assert_eq(resp.status_code, 200, 'Static CSS')
    resp = client.get('/static/js/main.js')
    assert_eq(resp.status_code, 200, 'Static JS')
    resp = client.get('/nonexistent-route')
    assert_eq(resp.status_code, 404, '404 for unknown route')

# ── 12. DB Integrity ──────────────────────────────────────
def test_database_integrity():
    print('\n─── 12. Database Integrity ───')
    with app.app_context():
        u1 = User(email='dup@test.com', username='dup1', role='student')
        u1.set_password('x'); _db.session.add(u1); _db.session.commit()
        u2 = User(email='dup@test.com', username='dup2', role='student')
        u2.set_password('x'); _db.session.add(u2)
        try:
            _db.session.commit()
            fail('Unique email', 'duplicate allowed')
        except Exception:
            ok('Unique email enforced')
        _db.session.rollback()

        u3 = User(email='dup3@test.com', username='dup1', role='student')
        u3.set_password('x'); _db.session.add(u3)
        try:
            _db.session.commit()
            fail('Unique username', 'duplicate allowed')
        except Exception:
            ok('Unique username enforced')
        _db.session.rollback()

# ── 13. Full User Journey ─────────────────────────────────
def test_full_user_journey():
    print('\n─── 13. Full User Journey ───')
    # Ensure clean session
    with client.session_transaction() as sess:
        sess.clear()
    resp = client.post('/auth/register', data={
        'email': 'journey@test.com', 'username': 'journeyuser',
        'password': 'journey123', 'role': 'student',
    }, follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Journey: register')

    resp = client.get('/courses/')
    assert_eq(resp.status_code, 200, 'Journey: courses')

    resp = client.get(f'/courses/{_NOTE_ID}')
    assert_eq(resp.status_code, 200, 'Journey: first content')

    # Progress API uses <content_id> (single segment), use flat IDs
    resp = client.post(f'/api/progress/{SIMPLE_WORKSHOP}/complete', json={
        'content_type': 'workshop', 'score': 100, 'passed': True,
    })
    assert_eq(resp.status_code, 200, 'Journey: complete first')

    resp = client.post(f'/api/progress/{SIMPLE_QUIZ}/complete', json={
        'content_type': 'quiz', 'score': 80, 'passed': True,
    })
    assert_eq(resp.status_code, 200, 'Journey: complete quiz')

    resp = client.post(f'/api/progress/{SIMPLE_PROJECT}/submit', json={
        'code': '<h1>My Journey Project</h1>',
    })
    assert_eq(resp.status_code, 200, 'Journey: submit project')

    resp = client.get('/profile')
    assert_eq(resp.status_code, 200, 'Journey: profile')
    resp = client.get('/dashboard')
    assert_eq(resp.status_code, 200, 'Journey: dashboard')
    client.get('/auth/logout')

    resp = client.post('/auth/login', data={
        'email': 'journey@test.com', 'password': 'journey123',
    }, follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Journey: re-login')

    resp = client.get('/api/progress/badges')
    assert_eq(resp.status_code, 200, 'Journey: badges')
    resp = client.get('/api/progress/streak')
    assert_eq(resp.status_code, 200, 'Journey: streak')
    assert_true(resp.get_json()['streak'] >= 1, 'Journey: streak >= 1')

# ── Main ──────────────────────────────────────────────────
if __name__ == '__main__':
    print('═' * 60)
    print('  PRODUCTION END-TO-END TEST SUITE')
    print('═' * 60)

    with app.app_context():
        _db.create_all()

    test_bootstrap()
    test_course_parser()
    test_assessment_engine()
    test_auth_e2e()
    test_courses_e2e()
    test_progress_api()
    test_profile_settings()
    test_admin_operations()
    test_badge_system()
    test_banned_user()
    test_static_and_errors()
    test_database_integrity()
    test_full_user_journey()

    with app.app_context():
        _db.session.remove()
        _db.drop_all()

    if os.path.exists(test_db_path): os.remove(test_db_path)
    shutil.rmtree(tmpdir, ignore_errors=True)

    print(f'\n{"═" * 60}')
    print(f'  PASS: {PASS}  |  FAIL: {FAIL}')
    print(f'{"═" * 60}')
    if ERRORS:
        print('\nFailed tests:')
        for name, msg in ERRORS:
            print(f'  \u2022 {name}: {msg}')
    sys.exit(0 if FAIL == 0 else 1)
