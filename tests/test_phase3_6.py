"""
Phase 3–6 — Workshops, Projects, Profile & Achievement Verification

Tests:
  3.x Workshop progress persistence API
  3.x Workshop completion marking
  4.x Practical workshop validation
  5.x Project submission
  5.x Instructor verdict
  6.x Profile & settings
  6.x Achievement triggers
"""

import os
import sys
import json

TESTS_PASSED = 0
TESTS_FAILED = 0

def test(name, condition, detail=''):
    global TESTS_PASSED, TESTS_FAILED
    if condition:
        TESTS_PASSED += 1
        print(f"  \u2713 {name}")
    else:
        TESTS_FAILED += 1
        print(f"  \u2717 {name}  <-- FAIL")
        if detail:
            print(f"      {detail}")

def assert_eq(name, got, expected):
    test(name, got == expected, f"expected {expected!r}, got {got!r}")

os.environ['SECRET_KEY'] = 'test-secret'
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import create_app, db as _db
from app.models.user import User
from app.models.progress import Progress

flask_app = create_app()

with flask_app.app_context():
    u = User(email='student@test.com', username='testuser', role='student')
    u.set_password('test')
    _db.session.add(u)
    _db.session.commit()
    uid = u.id

    inst = User(email='inst@test.com', username='instructor1', role='instructor')
    inst.set_password('pass')
    _db.session.add(inst)
    _db.session.commit()
    iid = inst.id

print("\n[3] Workshop Progress Persistence")
with flask_app.app_context():
    p = Progress(user_id=uid, content_id='html-basics-workshop', content_type='workshop', step_index=2)
    _db.session.add(p)
    _db.session.commit()

    fetched = _db.session.get(Progress, p.id)
    assert_eq('Step index saved as 2', fetched.step_index, 2)
    assert_eq('Content ID correct', fetched.content_id, 'html-basics-workshop')
    assert_eq('Content type correct', fetched.content_type, 'workshop')
    test('Not completed yet', fetched.completed is False)

print("\n[3.2] Workshop Completion")
with flask_app.app_context():
    p = Progress.query.filter_by(user_id=uid, content_id='html-basics-workshop').first()
    p.completed = True
    _db.session.commit()
    fetched = _db.session.get(Progress, p.id)
    test('Marked as completed', fetched.completed is True)

print("\n[4] Progress + Assessment Score")
with flask_app.app_context():
    p2 = Progress(user_id=uid, content_id='hardware-quiz', content_type='quiz', score=80.0, passed=True, completed=True)
    _db.session.add(p2)
    _db.session.commit()
    fetched = _db.session.get(Progress, p2.id)
    assert_eq('Score 80.0', fetched.score, 80.0)
    test('Passed is True', fetched.passed is True)
    test('Completed is True', fetched.completed is True)

print("\n[5] Project Submission")
with flask_app.app_context():
    code_snapshot = '<html><body><h1>My Portfolio</h1></body></html>'
    p3 = Progress(
        user_id=uid,
        content_id='final-project',
        content_type='project',
        submission=code_snapshot,
    )
    _db.session.add(p3)
    _db.session.commit()
    fetched = _db.session.get(Progress, p3.id)
    test('Submission saved', fetched.submission == code_snapshot)
    test('Not yet completed (awaiting review)', fetched.completed is False)
    test('No verdict yet', fetched.verdict is None)

print("\n[5.2] Instructor Verdict")
with flask_app.app_context():
    p3 = Progress.query.filter_by(user_id=uid, content_id='final-project').first()
    p3.verdict = 'passed'
    p3.completed = True
    _db.session.commit()
    fetched = _db.session.get(Progress, p3.id)
    assert_eq('Verdict is passed', fetched.verdict, 'passed')
    test('Marked completed after passing', fetched.completed is True)

    p3.verdict = 'retry'
    p3.completed = False
    _db.session.commit()
    fetched = _db.session.get(Progress, p3.id)
    assert_eq('Verdict changed to retry', fetched.verdict, 'retry')

print("\n[6] Profile & Settings")
with flask_app.app_context():
    user = _db.session.get(User, uid)
    user.profile_visibility = 'private'
    user.bio = 'Learning to code'
    _db.session.commit()
    fetched = _db.session.get(User, uid)
    assert_eq('Profile visibility', fetched.profile_visibility, 'private')
    assert_eq('Bio saved', fetched.bio, 'Learning to code')

print("\n[6.2] Completion Tracking (Achievement Foundation)")
with flask_app.app_context():
    all_completed = Progress.query.filter_by(user_id=uid, completed=True).count()
    test('Has completed items', all_completed >= 2, f"found {all_completed}")

    passed_count = Progress.query.filter_by(user_id=uid, passed=True).count()
    test('Has passed assessments', passed_count >= 1)

print("\n[E2E] API Route Registration")
with flask_app.app_context():
    rules = sorted([r.rule for r in flask_app.url_map.iter_rules()])
    route_check = {
        '/auth/register': 'Auth register',
        '/auth/login': 'Auth login',
        '/auth/logout': 'Auth logout',
        '/': 'Home',
        '/courses/': 'Course tree',
        '/courses/<path:content_id>': 'Content view',
        '/api/progress/<content_id>': 'Progress GET',
        '/api/progress/<content_id>/step': 'Step save',
        '/api/progress/<content_id>/complete': 'Complete',
        '/api/progress/<content_id>/submit': 'Submit',
        '/api/progress/<content_id>/verdict': 'Verdict',
    }
    for rule, name in route_check.items():
        test(f'{name} route registered ({rule})', rule in rules)

print("\n" + "=" * 50)
print(f"RESULTS:  {TESTS_PASSED} passed, {TESTS_FAILED} failed")
print("=" * 50)
sys.exit(0 if TESTS_FAILED == 0 else 1)
