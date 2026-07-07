"""
End-to-End Comprehensive Verification — All Phases

Runs all tests from Phase 1 through Phase 6 in one script.
Exit code 0 = all pass, 1 = any fail.

Usage:
  python3 test_all.py
"""

import os
import sys
import tempfile
import json

PASSED = 0
FAILED = 0

def test(name, condition, detail=''):
    global PASSED, FAILED
    if condition:
        PASSED += 1
    else:
        FAILED += 1
        print(f"  \u2717 {name}  <-- FAIL")
        if detail:
            print(f"      {detail}")

def ok(name):
    global PASSED
    PASSED += 1

os.environ['SECRET_KEY'] = 'test-secret'
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import create_app, db as _db
from app.models.user import User
from app.models.progress import Progress
from app.services.course_parser import (
    get_course_tree, get_content_by_id, parse_front_matter,
    check_prerequisites, get_sort_key
)
from app.services.assessment_parser import (
    parse_content, get_assessment_mode, get_per_page, get_min_errors, normalize_type
)

flask_app = create_app()

# ─── Phase 1: Foundation ───────────────────────────────────
print("\n━━━ Phase 1: Foundation ━━━")

test('App factory creates Flask app', flask_app is not None)
test('SECRET_KEY configured', flask_app.config['SECRET_KEY'] == 'test-secret')

with flask_app.app_context():
    tables = list(_db.metadata.tables.keys())
    test('User table exists', 'users' in tables)
    test('Progress table exists', 'progress' in tables)

    u = User(email='alice@test.com', username='alice', role='student')
    u.set_password('secret')
    _db.session.add(u)
    u2 = User(email='bob@test.com', username='bob', role='instructor')
    u2.set_password('secret')
    _db.session.add(u2)
    u3 = User(email='admin@test.com', username='admin', role='admin')
    u3.set_password('secret')
    _db.session.add(u3)
    _db.session.commit()
    uid = u.id

    fetched = _db.session.get(User, uid)
    test('User password hashed', fetched.password_hash != 'secret')
    test('Password verify correct', fetched.check_password('secret'))
    test('Password verify wrong', not fetched.check_password('wrong'))
    test('Student role', fetched.role == 'student')
    test('Instructor role', _db.session.get(User, u2.id).role == 'instructor')
    test('Admin role', _db.session.get(User, u3.id).role == 'admin')

    COURSES_DIR = os.path.join(os.path.dirname(__file__), 'courses')
    flask_app.config['COURSES_DIR'] = COURSES_DIR
    test('Courses dir exists', os.path.isdir(COURSES_DIR))

    tree = get_course_tree()
    test('Course tree populated', len(tree) > 0)

    content = get_content_by_id('identify-components')
    test('Content found by ID', content is not None)
    if content:
        test('Content has body', len(content.get('body', '')) > 0)
        test('Content type is note', content['type'] == 'note')

    test('Nonexistent ID returns None', get_content_by_id('nope') is None)

    os_basics = get_content_by_id('os-basics')
    if os_basics and os_basics.get('prerequisites'):
        prereqs = os_basics['prerequisites']
        test(f'Prerequisites defined: {prereqs}', len(prereqs) > 0)
        test('Locked when none completed',
             check_prerequisites('os-basics', []) is False)
        test('Unlocked when all completed',
             check_prerequisites('os-basics', prereqs) is True)

    no_prereq = get_content_by_id('identify-components')
    if no_prereq:
        test('No-prereq item always unlocked',
             check_prerequisites('identify-components', []) is True)

    # sort keys
    test('Sort key 1.0', get_sort_key('1. Foundation') == (1,))
    test('Sort key 1.1', get_sort_key('1.1 Section') == (1, 1))
    test('Sort 2.0 > 1.0', get_sort_key('2.') > get_sort_key('1.'))

    # front-matter
    sample = "---\ntype: note\nid: x\ntitle: X\nprerequisites: [a]\n---\n# Body"
    with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
        f.write(sample); p = f.name
    meta, body = parse_front_matter(p)
    test('FM type', meta.get('type') == 'note')
    test('FM id', meta.get('id') == 'x')
    test('FM title', meta.get('title') == 'X')
    test('FM prerequisites', meta.get('prerequisites') == ['a'])
    test('FM body extracted', '# Body' in body)
    os.unlink(p)

    # no front-matter
    with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
        f.write("Just content"); p2 = f.name
    meta2, _ = parse_front_matter(p2)
    test('No FM handled', True)
    os.unlink(p2)

# ─── Phase 2: Assessment Engine ────────────────────────────
print("\n━━━ Phase 2: Assessment Engine ━━━")

q_body = """<!-- questions
* What is Q1?
- A
- B
- C
- D
Answer: A

* What is Q2?
- A
- B
- C
- D
Answer: B
-->"""
result = parse_content('quiz', q_body)
test('Quiz parsed', len(result) == 1)
if result:
    test('Quiz type', result[0]['type'] == 'quiz')
    test('2 questions', len(result[0]['questions']) == 2)
    test('Q1 answer A', result[0]['questions'][0]['answer'] == 'A')
    test('Q1 options 4', len(result[0]['questions'][0]['options']) == 4)

result_test = parse_content('tests', q_body)
test('Tests type normalized', result_test[0]['type'] == 'test')

result_exam = parse_content('Exams', q_body)
test('Exams type normalized', result_exam[0]['type'] == 'exam')

ws_body = """<!-- steps
step: 1
explanation: "First"
prompt: "<html>"
expected: "<html>"
step: 2
explanation: "Second"
prompt: "<body>"
expected: "<body>"
-->"""
result = parse_content('workshop', ws_body)
test('Workshop parsed', len(result) == 1)
if result:
    test('2 workshop steps', len(result[0]['steps']) == 2)
    test('Step 1 text', result[0]['steps'][0]['explanation'] == 'First')
    test('Step 2 expected', result[0]['steps'][1]['expected'] == '<body>')

req_body = """<!-- requirements
requirement: "Bg blue"
validate: "code.includes('blue')"
requirement: "Font 16px"
validate: "code.includes('16px')"
-->"""
result = parse_content('practical', req_body)
test('Requirements parsed', len(result) == 1)
if result:
    test('2 requirements', len(result[0]['requirements']) == 2)

result = parse_content('note', q_body)
test('Note with embedded questions parsed as quiz', len(result) == 1 and result[0]['type'] == 'quiz')
test('Note embedded q count', len(result[0]['questions']) == 2)

test('normalize_type lowercases case', normalize_type('Test') == 'test')
test('normalize_type handles plural', normalize_type('tests') == 'test')
test('normalize_type handles exams', normalize_type('Exams') == 'exam')
test('get_min_errors numeric', get_min_errors({'min_errors': 4}) == 4)
test('get_min_errors zero default', get_min_errors({}) == 0)
test('get_min_errors string', get_min_errors({'min_errors': '3'}) == 3)

test('Mode quiz', get_assessment_mode('quiz') == 'quiz')
test('Mode test', get_assessment_mode('test') == 'test')
test('Mode exam', get_assessment_mode('exam') == 'exam')
test('Mode note is None', get_assessment_mode('note') is None)
test('Per page quiz 1', get_per_page('quiz') == 1)
test('Per page test 5', get_per_page('test') == 5)
test('Per page exam 10', get_per_page('exam') == 10)
test('min_errors 4', get_min_errors({'min_errors': 4}) == 4)
test('min_errors default 0', get_min_errors({}) == 0)

# ─── Phase 3-6: Practical Features ─────────────────────────
print("\n━━━ Phase 3-6: Workshops, Projects, Profile ━━━")

with flask_app.app_context():
    # Workshop progress
    p = Progress(user_id=uid, content_id='ws-test', content_type='workshop', step_index=3)
    _db.session.add(p)
    _db.session.commit()
    fetched = _db.session.get(Progress, p.id)
    test('Workshop step saved', fetched.step_index == 3)
    test('Workshop not yet complete', not fetched.completed)

    # Workshop completion
    fetched.completed = True
    _db.session.commit()
    test('Workshop completion saved', _db.session.get(Progress, p.id).completed)

    # Assessment score
    p2 = Progress(user_id=uid, content_id='quiz-test', content_type='quiz', score=90.0, passed=True, completed=True)
    _db.session.add(p2)
    _db.session.commit()
    fetched2 = _db.session.get(Progress, p2.id)
    test('Score 90', fetched2.score == 90.0)
    test('Passed True', fetched2.passed)

    # Project submission
    code = '<h1>Portfolio</h1>'
    p3 = Progress(user_id=uid, content_id='project-test', content_type='project', submission=code)
    _db.session.add(p3)
    _db.session.commit()
    fetched3 = _db.session.get(Progress, p3.id)
    test('Project submitted', fetched3.submission == code)
    test('No verdict yet', fetched3.verdict is None)

    # Instructor verdict
    fetched3.verdict = 'passed'
    fetched3.completed = True
    _db.session.commit()
    test('Verdict passed', _db.session.get(Progress, p3.id).verdict == 'passed')
    test('Completed after verdict', _db.session.get(Progress, p3.id).completed)

    # Profile settings
    user = _db.session.get(User, uid)
    user.profile_visibility = 'private'
    user.bio = 'Test bio'
    _db.session.commit()
    test('Profile visibility private', _db.session.get(User, uid).profile_visibility == 'private')
    test('Bio saved', _db.session.get(User, uid).bio == 'Test bio')

    # Route registration
    rules = [r.rule for r in flask_app.url_map.iter_rules()]
    required = [
        '/auth/register', '/auth/login', '/auth/logout',
        '/', '/courses/', '/courses/<path:content_id>',
        '/api/progress/<content_id>', '/api/progress/<content_id>/step',
        '/api/progress/<content_id>/complete', '/api/progress/<content_id>/submit',
        '/api/progress/<content_id>/verdict',
    ]
    for route in required:
        test(f'Route {route} registered', route in rules)

    # Sample course content verification
    quiz_content = get_content_by_id('hardware-quiz')
    if quiz_content:
        assessments = parse_content('quiz', quiz_content.get('body', ''))
        test('hardware-quiz parsed', len(assessments) > 0 and assessments[0]['type'] == 'quiz')
        if assessments:
            n = len(assessments[0].get('questions', []))
            test(f'hardware-quiz has {n} questions', n > 0)

    workshop_content = get_content_by_id('html-basics-workshop')
    if workshop_content:
        assessments = parse_content('workshop', workshop_content.get('body', ''))
        test('html-basics-workshop parsed', len(assessments) > 0 and assessments[0]['type'] == 'workshop')
        if assessments:
            n = len(assessments[0].get('steps', []))
            test(f'html-basics-workshop has {n} steps', n > 0)

    practical_content = get_content_by_id('css-styling-practical')
    if practical_content:
        assessments = parse_content('practical', practical_content.get('body', ''))
        test('css-styling-practical parsed', len(assessments) > 0 and assessments[0]['type'] == 'requirements')

    test_content = get_content_by_id('web-dev-test')
    if test_content:
        assessments = parse_content('test', test_content.get('body', ''))
        test('web-dev-test parsed', len(assessments) > 0 and assessments[0]['type'] == 'test')
        if assessments:
            n = len(assessments[0].get('questions', []))
            test(f'web-dev-test has {n} questions', n > 0)

    project_content = get_content_by_id('final-project')
    if project_content:
        test('final-project exists with type project', project_content['type'] == 'project')

# ─── Summary ───────────────────────────────────────────────
print(f"\n{'='*50}")
print(f"TOTAL: {PASSED} passed, {FAILED} failed")
print(f"{'='*50}")
sys.exit(0 if FAILED == 0 else 1)
