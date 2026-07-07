"""
End-to-end test: Phase A-F + Admin + Certificate enhancement.
Run: python3 test_e2e.py
"""
import os
import sys
import json
import tempfile
import shutil

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ['FLASK_ENV'] = 'testing'

# Point to a temp courses dir and test db
tmpdir = tempfile.mkdtemp()
test_db_path = os.path.join(os.path.dirname(__file__), 'instance', 'test_e2e.db')
os.environ['COURSES_DIR'] = tmpdir
os.environ['DATABASE_URL'] = f'sqlite:///{test_db_path}'

from app import create_app
from app.models.user import User as UserModel
from app.models.progress import Progress
from app.models.admin import Ban, Certificate, CertificateTemplate
from app.services.course_parser import (
    load_structure, save_structure, get_course_tree, path_to_id,
    name_to_title, parse_lock_value, check_item_locked, parse_front_matter,
    capture_structure
)
from app.services.assessment_parser import (
    normalize_type, parse_content, _parse_questions,
    _parse_steps, _parse_requirements, _parse_goal,
    get_min_errors, get_per_page
)

PASS = 0
FAIL = 0


def ok(name):
    global PASS
    PASS += 1
    print(f'  OK  {name}')


def fail(name, detail=''):
    global FAIL
    FAIL += 1
    msg = f'  FAIL  {name}'
    if detail:
        msg += f'  -- {detail}'
    print(msg)


def assert_eq(a, b, name):
    if a == b:
        ok(name)
    else:
        fail(name, f'expected {b!r}, got {a!r}')


def assert_true(v, name):
    if v:
        ok(name)
    else:
        fail(name, f'expected True, got {v!r}')


def assert_false(v, name):
    if not v:
        ok(name)
    else:
        fail(name, f'expected False, got {v!r}')


def create_course_content():
    """Create realistic course files for testing."""
    # Course structure
    course_dir = os.path.join(tmpdir, '1. Foundation Introduction')
    sub_dir = os.path.join(course_dir, '1.1 Operate Personal Computer')
    os.makedirs(sub_dir, exist_ok=True)

    note1 = os.path.join(sub_dir, '1.1.1 Identify Computer Components.md')
    with open(note1, 'w') as f:
        f.write('---\ntype: note\ntitle: Identify Computer Components\n---\n\n# Identify Components\n\nLearn about CPU, RAM, storage.')

    note2 = os.path.join(sub_dir, '1.1.2 Operating System Basics.md')
    with open(note2, 'w') as f:
        f.write('---\ntype: note\n---\n\n# OS Basics\n\nUnderstanding operating systems.')

    quiz = os.path.join(sub_dir, '1.1.3 Computer Hardware Quiz.md')
    with open(quiz, 'w') as f:
        f.write('---\ntype: quiz\n---\n\n<!-- questions\n* What does CPU stand for?\n- Central Processing Unit\n- Computer Personal Unit\n- Central Program Utility\n- Core Processing Unit\nAnswer: A\n* What is RAM?\n- Read Access Memory\n- Random Access Memory\n- Rapid Access Module\n- Read and Modify\nAnswer: B\n-->')

    workshop = os.path.join(sub_dir, '1.1.4 HTML Basics Workshop.md')
    with open(workshop, 'w') as f:
        f.write('---\ntype: workshop\n---\n\n<!-- steps\nstep: 1\nexplanation: "Create an HTML document"\nprompt: "Write the DOCTYPE declaration"\nexpected: "<!DOCTYPE html>"\nstep: 2\nexplanation: "Add the html element"\nprompt: "Write the opening html tag"\nexpected: "<html>"\n-->')

    practical_dir = os.path.join(course_dir, '1.2 Web Development')
    os.makedirs(practical_dir, exist_ok=True)

    practical = os.path.join(practical_dir, '1.2.1 CSS Styling Practical.md')
    with open(practical, 'w') as f:
        f.write('---\ntype: practical\n---\n\n<!-- requirements\nrequirement: "Use a heading element"\nvalidate: "code.includes(\'<h1>\')"\ngoal: "<h1>Hello</h1>"\nrequirement: "Add a paragraph"\nvalidate: "code.includes(\'<p>\')"\n-->\n\nWrite a simple HTML page with a heading and paragraph.\n\n<!-- goal\n<h1 style="color:#046D8B;">Hello World</h1>\n<p>This is a sample paragraph.</p>\n-->')

    test_file = os.path.join(practical_dir, '1.2.2 Web Development Test.md')
    with open(test_file, 'w') as f:
        f.write('---\ntype: Tests\nmin_errors: 1\n---\n\n<!-- questions\n* What tag creates a hyperlink?\n- <a>\n- <link>\n- <href>\n- <url>\nAnswer: A\n* Which CSS property changes text color?\n- font-color\n- text-color\n- color\n- foreground\nAnswer: C\n-->')

    project_file = os.path.join(course_dir, '1.3 Final Project.md')
    with open(project_file, 'w') as f:
        f.write('---\ntype: project\n---\n\n# Final Project\n\nBuild a complete HTML page.')


# ============================================================
# PHASE A — Foundation
# ============================================================
def test_phase_a(app, client):
    print('\n--- PHASE A: Foundation ---')

    # App factory + DB
    with app.app_context():
        from app import db
        assert_true(os.path.exists(app.config['COURSES_DIR']), 'Courses dir exists')

        # User creation
        u = UserModel(email='test@test.com', username='testuser', role='student')
        u.set_password('secret123')
        db.session.add(u)
        db.session.commit()
        assert_eq(u.role, 'student', 'User role default')
        assert_true(u.check_password('secret123'), 'Password check')
        assert_false(u.is_banned, 'Not banned by default')

        # Admin user
        admin = UserModel(email='admin@test.com', username='admin', role='admin')
        admin.set_password('admin123')
        db.session.add(admin)
        db.session.commit()

        # Ban model
        ban = Ban(user_id=u.id, banned_by=admin.id, reason='test ban')
        db.session.add(ban)
        db.session.commit()
        assert_true(u.is_banned, 'User is banned')
        ban.active = False
        db.session.commit()
        assert_false(u.is_banned, 'User unbanned')

    # Course parser
    with app.app_context():
        app.config['COURSES_DIR'] = tmpdir
        tree = get_course_tree()
        assert_true(len(tree) > 0, 'Course tree has entries')

        # Path to ID
        assert_eq(path_to_id('1. Foundation/1.1 File.md'), 'foundation/file', 'path_to_id basic')
        assert_eq(path_to_id('courses/'), 'courses', 'path_to_id trailing slash')

        # Name to title
        assert_eq(name_to_title('1.1.3 My Note.md'), 'My Note', 'name_to_title strips prefix')
        assert_eq(name_to_title('Simple.md'), 'Simple', 'name_to_title no prefix')

        # Front matter
        note_path = os.path.join(tmpdir, '1. Foundation Introduction/1.1 Operate Personal Computer/1.1.1 Identify Computer Components.md')
        meta, body = parse_front_matter(note_path)
        assert_eq(meta.get('type'), 'note', 'Front matter type parsed')
        assert_true('Identify Components' in body, 'Body extracted')

        # Capture structure
        struct = capture_structure()
        assert_true(len(struct) > 0, 'Structure captured')
        load_test = load_structure()
        assert_eq(len(struct), len(load_test), 'Load matches capture')

    # Lock/unlock
    with app.app_context():
        # Date lock — future date
        config_future = {'lock_type': 'date', 'lock_value': '31/12/30'}
        assert_true(check_item_locked(config_future), 'Future date locks')

        # Date lock — past date
        config_past = {'lock_type': 'date', 'lock_value': '01/01/20'}
        assert_false(check_item_locked(config_past), 'Past date unlocks')

        # Date lock — relative offset
        config_rel = {'lock_type': 'date', 'lock_value': '99 years'}
        assert_true(check_item_locked(config_rel), 'Relative future locks')

        # Pass type
        config_pass = {'lock_type': 'pass'}
        assert_true(check_item_locked(config_pass), 'Pass type locks')

        # Manual type
        config_manual = {'lock_type': 'manual'}
        assert_true(check_item_locked(config_manual), 'Manual type locks')

        # No lock
        assert_false(check_item_locked({}), 'No lock config')
        assert_false(check_item_locked({'lock_type': None}), 'Null lock type')

        # Parse lock value
        future = parse_lock_value('31/12/30')
        assert_true(future is not None, 'Parse date lock value')

        past = parse_lock_value('01/01/20')
        assert_true(past is not None, 'Parse past date')

        relative = parse_lock_value('7 days')
        assert_true(relative is not None, 'Parse relative offset')

        assert_eq(parse_lock_value(None), None, 'Parse None lock value')
        assert_eq(parse_lock_value(''), None, 'Parse empty lock value')

    # Landing page redirects
    resp = client.get('/')
    assert_eq(resp.status_code, 200, 'Landing page (guest)')
    assert_true(b'DigitalEdu' in resp.data, 'Landing shows branding')

    # Login
    resp = client.post('/auth/login', data={
        'email': 'test@test.com', 'password': 'secret123'
    }, follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Login success')
    assert_true(b'Dashboard' in resp.data or b'Welcome' in resp.data, 'Login redirects to dashboard')

    # Admin login redirect
    client.get('/auth/logout')
    resp = client.post('/auth/login', data={
        'email': 'admin@test.com', 'password': 'admin123'
    }, follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Admin login')

    # Dashboard
    resp = client.get('/admin/', follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Admin dashboard accessible')

    # Settings page (GET)
    client.get('/auth/logout')
    client.post('/auth/login', data={
        'email': 'test@test.com', 'password': 'secret123'
    })
    resp = client.get('/settings', follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Settings page accessible')

    # Settings page (POST)
    resp = client.post('/settings', data={
        'visibility': 'private'
    }, follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Settings POST works')

    # Change password
    resp = client.post('/auth/change-password', data={
        'current_password': 'secret123',
        'new_password': 'newpass123',
        'confirm_password': 'newpass123',
    }, follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Password change')
    # Verify new password
    with app.app_context():
        u = UserModel.query.filter_by(email='test@test.com').first()
        assert_true(u.check_password('newpass123'), 'New password works')

    # Logout
    resp = client.get('/auth/logout', follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Logout')


# ============================================================
# PHASE B — Assessment Engine
# ============================================================
def test_phase_b():
    print('\n--- PHASE B: Assessment Engine ---')

    # Type normalization
    assert_eq(normalize_type('quiz'), 'quiz', 'normalize quiz')
    assert_eq(normalize_type('QUIZ'), 'quiz', 'normalize QUIZ')
    assert_eq(normalize_type('Quizzes'), 'quiz', 'normalize Quizzes')
    assert_eq(normalize_type('quizes'), 'quiz', 'normalize quizes')
    assert_eq(normalize_type('Tests'), 'test', 'normalize Tests')
    assert_eq(normalize_type('Exam'), 'exam', 'normalize Exam')
    assert_eq(normalize_type('workshop'), 'workshop', 'normalize workshop')
    assert_eq(normalize_type('practical'), 'practical', 'normalize practical')
    assert_eq(normalize_type('project'), 'project', 'normalize project')
    assert_eq(normalize_type(''), 'note', 'normalize empty')
    assert_eq(normalize_type('unknown'), 'unknown', 'normalize unknown')

    # Question parsing
    questions_text = """* What does CPU stand for?
- Central Processing Unit
- Computer Personal Unit
- Central Program Utility
- Core Processing Unit
Answer: A
* What is RAM?
- Read Access Memory
- Random Access Memory
- Rapid Access Module
- Read and Modify
Answer: B"""
    questions = _parse_questions(f'<!-- questions\n{questions_text}-->')
    assert_eq(len(questions), 2, 'Parsed 2 questions')
    assert_eq(questions[0]['answer'], 'A', 'First answer A')
    assert_eq(questions[1]['answer'], 'B', 'Second answer B')
    assert_eq(len(questions[0]['options']), 4, 'First question has 4 options')

    # Notes with embedded questions
    note_body = '# Note\n\nContent here.\n\n<!-- questions\n* Q1?\n- A\n- B\n- C\n- D\nAnswer: A\n-->'
    result = parse_content('note', note_body)
    assert_eq(len(result), 1, 'Note with questions returns quiz')
    assert_eq(result[0]['type'], 'quiz', 'Note embedded quiz type')

    # Quiz mode
    assert_eq(get_per_page('quiz'), 1, 'Quiz: 1 per page')
    assert_eq(get_per_page('test'), 5, 'Test: 5 per page')
    assert_eq(get_per_page('exam'), 10, 'Exam: 10 per page')

    # min_errors
    meta = {'min_errors': 2}
    assert_eq(get_min_errors(meta), 2, 'min_errors from meta')

    # Workshop steps
    steps_text = """step: 1
explanation: "First step"
prompt: "Do something"
expected: "result1"
step: 2
explanation: "Second step"
prompt: "Do another"
expected: "result2\""""
    steps = _parse_steps(f'<!-- steps\n{steps_text}-->')
    assert_eq(len(steps), 2, 'Parsed 2 workshop steps')
    assert_eq(steps[0]['expected'], 'result1', 'First step expected')
    assert_eq(steps[1]['expected'], 'result2', 'Second step expected')

    # Practical requirements
    reqs_text = """requirement: "Use heading"
validate: "code.includes('<h1>')"
goal: "<h1>Hello</h1>"
requirement: "Add paragraph"
validate: "code.includes('<p>')\""""
    reqs = _parse_requirements(f'<!-- requirements\n{reqs_text}-->')
    assert_eq(len(reqs), 2, 'Parsed 2 requirements')
    assert_eq(reqs[0]['requirement'], 'Use heading', 'First requirement text')
    assert_eq(reqs[0].get('goal'), '<h1>Hello</h1>', 'Goal extracted')
    assert_eq(reqs[1]['validate'], "code.includes('<p>')", 'Second validate')

    # Goal block parsing
    goal_body = 'Some text\n\n<!-- goal\nExpected output here\n-->'
    goal = _parse_goal(goal_body)
    assert_eq(goal, 'Expected output here', 'Goal block parsed')

    # Practical content with goal
    ct_result = parse_content('practical', practical_body := f'Text\n<!-- requirements\nrequirement: "Test"\nvalidate: "code.includes(\'x\')"\n-->\n\n<!-- goal\nGoal HTML\n-->')
    assert_eq(len(ct_result), 1, 'Practical parsed')
    assert_eq(ct_result[0].get('goal'), 'Goal HTML', 'Goal attached to result')


# ============================================================
# PHASE C — Workshop
# ============================================================
def test_phase_c(client):
    print('\n--- PHASE C: Workshop ---')

    with client.application.app_context():
        from app import db
        u = UserModel.query.filter_by(email='test@test.com').first()
        if not u:
            u = UserModel(email='ws_test@test.com', username='wstest')
            u.set_password('test')
            db.session.add(u)
            db.session.commit()

    client.post('/auth/login', data={
        'email': 'test@test.com',
        'password': 'newpass123'
    }, follow_redirects=True)

    # Progress API — get progress
    resp = client.get('/api/progress/test-content')
    assert_eq(resp.status_code, 200, 'Get progress returns JSON')
    data = resp.get_json()
    assert_true('step_index' in data, 'Progress has step_index')

    # Save step
    resp = client.post('/api/progress/test-content/step', json={'step_index': 3})
    assert_eq(resp.status_code, 200, 'Save step')
    assert_eq(resp.get_json().get('step_index'), 3, 'Step index saved')

    # Complete content
    resp = client.post('/api/progress/test-content/complete', json={
        'content_type': 'workshop', 'score': 100, 'passed': True
    })
    assert_eq(resp.status_code, 200, 'Complete content')
    assert_true(resp.get_json().get('completed'), 'Marked as completed')


# ============================================================
# PHASE D — Practical
# ============================================================
def test_phase_d():
    print('\n--- PHASE D: Practical ---')

    # Practical workshop requirements with validate
    reqs = _parse_requirements('<!-- requirements\nrequirement: "Use heading"\nvalidate: "code.includes(\'<h1>\')"\n-->')
    assert_eq(len(reqs), 1, 'Practical requirement parsed')
    assert_eq(reqs[0]['requirement'], 'Use heading', 'Requirement text')
    assert_eq(reqs[0]['validate'], "code.includes('<h1>')", 'Validate expression')

    # Goal block
    goal = _parse_goal('<!-- goal\n<h1>Hello</h1>\n-->')
    assert_eq(goal, '<h1>Hello</h1>', 'Practical goal parsed')

    # Content parsing for practical
    body = 'Text\n<!-- requirements\nrequirement: "Req 1"\nvalidate: "code.includes(\'x\')"\n-->\n\n<!-- goal\nGoal HTML\n-->'
    result = parse_content('practical', body)
    assert_eq(result[0]['type'], 'requirements', 'Practical type')
    assert_eq(result[0].get('goal'), 'Goal HTML', 'Practical goal')


# ============================================================
# PHASE E — Projects
# ============================================================
def test_phase_e(client):
    print('\n--- PHASE E: Projects ---')

    # Project submission
    resp = client.post('/api/progress/final-project/submit', json={
        'code': '<html><body>Hello</body></html>'
    })
    assert_eq(resp.status_code, 200, 'Submit project')
    assert_true(resp.get_json().get('submitted'), 'Submission confirmed')

    # Get progress to verify
    resp = client.get('/api/progress/final-project')
    assert_eq(resp.status_code, 200, 'Get project progress')
    assert_eq(resp.get_json().get('submission'), '<html><body>Hello</body></html>', 'Submission stored')

    # Re-submit (should work)
    resp = client.post('/api/progress/final-project/submit', json={
        'code': '<html><body>Updated</body></html>'
    })
    assert_eq(resp.status_code, 200, 'Re-submit project')
    assert_true(resp.get_json().get('submitted'), 'Re-submission confirmed')

    # Submit as different user for verdict testing
    with client.application.app_context():
        from app import db
        u2 = UserModel.query.filter_by(email='student2').first()
        if not u2:
            u2 = UserModel(email='student2@test.com', username='student2')
            u2.set_password('test')
            db.session.add(u2)
            db.session.commit()
        p = Progress.query.filter_by(content_id='test-project', user_id=u2.id).first()
        if not p:
            p = Progress(
                user_id=u2.id, content_id='test-project',
                content_type='project', submission='code', verdict='retry'
            )
            db.session.add(p)
            db.session.commit()

    # Get user2_id
    user2_id = None
    with client.application.app_context():
        from app import db
        u2 = UserModel.query.filter_by(email='student2@test.com').first()
        user2_id = u2.id if u2 else None

    # Login as admin via session
    with client.session_transaction() as sess:
        sess['_user_id'] = '2'
        sess['_fresh'] = True

    if user2_id:
        resp = client.post('/api/progress/test-project/verdict', json={
            'verdict': 'passed', 'user_id': user2_id
        })
        if resp.status_code == 200:
            ok('Admin sets verdict')
            data = resp.get_json()
            if data and data.get('verdict') == 'passed':
                ok('Verdict stored')
            else:
                fail('Verdict stored', f'unexpected: {data}')
        else:
            fail('Admin sets verdict', f'expected 200, got {resp.status_code}')
            fail('Verdict stored', 'skipped')
    else:
        fail('Admin sets verdict', 'student2 not found')
        fail('Verdict stored', 'skipped')

    # Re-submit after retry (student re-submits, verdict resets)
    client.post('/auth/login', data={'email': 'student2@test.com', 'password': 'test'})
    resp = client.post('/api/progress/test-project/submit', json={'code': 'new code'})
    assert_eq(resp.status_code, 200, 'Re-submit after retry')
    # Verify verdict was reset
    resp = client.get('/api/progress/test-project')
    data = resp.get_json()
    assert_eq(data.get('verdict'), None, 'Verdict reset on re-submit')
    assert_false(data.get('completed'), 'Completed reset on re-submit')


# ============================================================
# PHASE F — Profile & Settings
# ============================================================
def test_phase_f(client):
    print('\n--- PHASE F: Profile & Settings ---')

    # Profile page
    resp = client.get('/profile', follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Profile page')

    # Settings page
    resp = client.get('/settings', follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Settings page')

    # User dashboard
    resp = client.get('/dashboard', follow_redirects=True)
    assert_eq(resp.status_code, 200, 'Dashboard')


# ============================================================
# ADMIN
# ============================================================
def test_admin(client, app):
    print('\n--- ADMIN ---')

    # Login as admin via session manipulation
    with client.session_transaction() as sess:
        sess['_user_id'] = '2'  # admin user id
        sess['_fresh'] = True
    
    # Verify we can access admin
    resp = client.get('/admin/')
    if resp.status_code != 200:
        fail('Admin login', f'admin dash returned {resp.status_code}')
        return

    # Admin dashboard
    resp = client.get('/admin/')
    assert_eq(resp.status_code, 200, 'Admin dashboard')

    # Content manager
    resp = client.get('/admin/content')
    assert_eq(resp.status_code, 200, 'Admin content page')

    # Capture structure
    resp = client.post('/admin/api/capture')
    assert_eq(resp.status_code, 200, 'Capture structure')
    data = resp.get_json()
    assert_true(len(data) > 0, 'Captured items')

    # Get structure
    resp = client.get('/admin/api/structure')
    assert_eq(resp.status_code, 200, 'Get structure')

    # Update single item
    item_id = list(data.keys())[0]
    resp = client.post('/admin/api/update-item', json={
        'id': item_id,
        'updates': {'title': 'Updated Title', 'hidden': False}
    })
    assert_eq(resp.status_code, 200, 'Update single item')

    # Batch update
    resp = client.post('/admin/api/batch-update', json={
        'ids': [item_id],
        'updates': {'lock_type': 'pass'}
    })
    assert_eq(resp.status_code, 200, 'Batch update items')

    # Content preview (find a file-type item)
    file_item_id = None
    for cid, info in data.items():
        if info.get('type') != 'category':
            file_item_id = cid
            break
    if file_item_id:
        resp = client.get(f'/admin/api/content-preview/{file_item_id}')
        assert_eq(resp.status_code, 200, 'Content preview')

        # Save content
        resp = client.post('/admin/api/save-content', json={
            'id': file_item_id,
            'body': '# Updated body\n\nNew content here.'
        })
        assert_eq(resp.status_code, 200, 'Save content body')
    else:
        fail('Content preview', 'no file-type item found')
        fail('Save content body', 'skipped')

    # User management
    resp = client.get('/admin/users')
    assert_eq(resp.status_code, 200, 'Users page')

    resp = client.get('/admin/api/users')
    assert_eq(resp.status_code, 200, 'Users JSON')

    # Ban user
    with client.application.app_context():
        u = UserModel.query.filter_by(email='student2@test.com').first()
    resp = client.post(f'/admin/api/users/{u.id}/ban', json={
        'duration': 7, 'unit': 'days', 'reason': 'Test ban'
    })
    assert_eq(resp.status_code, 200, 'Ban user')

    # Unban user
    resp = client.post(f'/admin/api/users/{u.id}/unban')
    assert_eq(resp.status_code, 200, 'Unban user')

    # Submissions
    resp = client.get('/admin/submissions')
    assert_eq(resp.status_code, 200, 'Submissions page')

    resp = client.get('/admin/api/submissions')
    assert_eq(resp.status_code, 200, 'Submissions JSON')

    # Submissions verdict
    with client.application.app_context():
        p = Progress.query.filter_by(content_id='test-project').first()
    if p:
        resp = client.post(f'/admin/api/submissions/{p.id}/verdict', json={
            'verdict': 'passed'
        })
        assert_eq(resp.status_code, 200, 'Submission verdict')

    # Certificate templates
    resp = client.get('/admin/certificates')
    assert_eq(resp.status_code, 200, 'Certificates page')

    resp = client.get('/admin/api/certificate-templates')
    assert_eq(resp.status_code, 200, 'Cert templates list')

    # Create template
    resp = client.post('/admin/api/certificate-templates', json={
        'name': 'Test Cert',
        'header': 'Certificate of Completion',
        'subtitle': 'D',
        'description': 'Academic description',
        'issuer': 'Digital-Edu',
        'footer': 'Prepared by Ethco Coders',
    })
    assert_eq(resp.status_code, 200, 'Create template')
    tpl_id = resp.get_json().get('id')

    # Update template
    resp = client.put(f'/admin/api/certificate-templates/{tpl_id}', json={
        'name': 'Updated Cert',
        'subtitle': 'D+',
    })
    assert_eq(resp.status_code, 200, 'Update template')

    # Award certificate
    with client.application.app_context():
        u = UserModel.query.filter_by(email='test@test.com').first()
    resp = client.post('/admin/api/award-certificate', json={
        'user_id': u.id,
        'category_id': 'foundation-introduction',
        'category_title': 'Foundation Introduction',
        'subcategory_ids': 'os-basics,html-workshop',
        'template_id': tpl_id,
    })
    assert_eq(resp.status_code, 200, 'Award certificate')
    cert_id = resp.get_json().get('id')
    assert_true(cert_id is not None, 'Certificate ID returned')

    # List certificates
    resp = client.get('/admin/api/certificates')
    assert_eq(resp.status_code, 200, 'Certificates list')

    # Profile shows certificates (login as test user who was awarded the cert)
    with client.session_transaction() as sess:
        sess.clear()
    resp = client.post('/auth/login', data={
        'email': 'test@test.com', 'password': 'newpass123'
    }, follow_redirects=True)
    resp = client.get('/profile', follow_redirects=True)
    has_cert = b'Foundation Introduction' in resp.data
    assert_true(has_cert, 'Certificate shown on profile')


# ============================================================
# EDGE CASES
# ============================================================
def test_edge_cases():
    print('\n--- EDGE CASES ---')

    # Empty front matter -> default type 'note'
    fpath = os.path.join(tmpdir, 'empty.md')
    with open(fpath, 'w') as f:
        f.write('Just content, no front matter')
    meta, body = parse_front_matter(fpath)
    assert_eq(meta.get('type'), 'note', 'No front matter defaults to note')

    with open(fpath, 'w') as f:
        f.write('---\n---\n\nBody')
    meta, body = parse_front_matter(fpath)
    assert_eq(meta.get('type'), 'note', 'Empty front matter')

    # Type normalization edge cases
    assert_eq(normalize_type(None), 'note', 'None type')
    assert_eq(normalize_type('  Quiz  '), 'quiz', 'Whitespace padded')

    # parse_content non-matching types
    assert_eq(parse_content('note', 'no questions'), [], 'Note without questions')
    assert_eq(parse_content('unknown', 'body'), [], 'Unknown type')

    # get_assessment_mode
    from app.services.assessment_parser import get_assessment_mode
    assert_eq(get_assessment_mode('quiz'), 'quiz', 'Mode quiz')
    assert_eq(get_assessment_mode('test'), 'test', 'Mode test')
    assert_eq(get_assessment_mode('exam'), 'exam', 'Mode exam')
    assert_eq(get_assessment_mode('note'), None, 'Mode note returns None')

    # Check item locked with invalid config
    assert_false(check_item_locked(None), 'None config')
    assert_false(check_item_locked({'lock_type': 'invalid'}), 'Invalid lock type')

    # Parse lock value invalid
    assert_eq(parse_lock_value('not-a-date'), None, 'Invalid lock value')
    assert_eq(parse_lock_value('abc'), None, 'Random string')

    # Course tree with empty dir
    empty_dir = os.path.join(tmpdir, 'empty_course')
    os.makedirs(empty_dir, exist_ok=True)


# ============================================================
# RUN
# ============================================================
if __name__ == '__main__':
    # Ensure clean DB
    if os.path.exists(test_db_path):
        os.remove(test_db_path)

    app = create_app()
    app.config['TESTING'] = True
    app.config['WTF_CSRF_ENABLED'] = False
    app.config['SERVER_NAME'] = 'localhost'

    with app.app_context():
        from app import db
        db.create_all()
        from app.services import course_parser

    create_course_content()

    client = app.test_client()

    test_phase_a(app, client)
    test_phase_b()
    test_phase_c(client)
    test_phase_d()
    test_phase_e(client)
    test_phase_f(client)
    test_admin(client, app)
    test_edge_cases()

    print(f'\n{"=" * 40}')
    print(f'  PASS: {PASS}  |  FAIL: {FAIL}')
    print(f'{"=" * 40}')

    # Cleanup
    shutil.rmtree(tmpdir, ignore_errors=True)

    if FAIL > 0:
        sys.exit(1)
    sys.exit(0)
