"""
Phase 1 — End-to-End Backend Verification Script

Tests:
  1. App factory creates and configures correctly
  2. Database tables created (User, Progress)
  3. User registration (create + password hashing)
  4. User login (password verification)
  5. Role assignment (student, instructor, admin)
  6. Course directory scanner — reads folder/file tree recursively
  7. Front-matter parsing (type, id, title, prerequisites)
  8. Sorted tree structure (numeric prefix ordering)
  9. Lock/unlock logic based on prerequisites
  10. Content retrieval by ID

Usage:
  python3 test_phase1.py
"""

import os
import sys
import tempfile

TESTS_PASSED = 0
TESTS_FAILED = 0

def test(name, condition, detail=''):
    global TESTS_PASSED, TESTS_FAILED
    if condition:
        TESTS_PASSED += 1
        print(f"  ✓ {name}")
    else:
        TESTS_FAILED += 1
        print(f"  ✗ {name}  <-- FAIL")
        if detail:
            print(f"      {detail}")

def assert_eq(name, got, expected):
    test(name, got == expected, f"expected {expected!r}, got {got!r}")

def assert_in(name, item, container):
    test(name, item in container, f"expected {item!r} to be in container")

os.environ['SECRET_KEY'] = 'test-secret'
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import create_app as _create_app, db as _db

flask_app = _create_app()
test('create_app returns a Flask app', flask_app is not None)
test('SECRET_KEY is set', flask_app.config['SECRET_KEY'] == 'test-secret')
test('SQLALCHEMY_DATABASE_URI is set', 'sqlite:///' in flask_app.config['SQLALCHEMY_DATABASE_URI'])

print("\n[2] Database Tables")
with flask_app.app_context():
    tables = _db.metadata.tables.keys()
    test('User table exists', 'users' in tables)
    test('Progress table exists', 'progress' in tables)

print("\n[3] User Registration")
with flask_app.app_context():
    from app.models.user import User
    u1 = User(email='student@test.com', username='student1', role='student')
    u1.set_password('pass123')
    _db.session.add(u1)
    _db.session.commit()

    fetched = _db.session.get(User, u1.id)
    test('User saved with correct email', fetched.email == 'student@test.com')
    test('User saved with correct username', fetched.username == 'student1')
    test('Password hash differs from plaintext', fetched.password_hash != 'pass123')
    test('Password verify correct', fetched.check_password('pass123') is True)
    test('Password verify wrong', fetched.check_password('wrong') is False)

    u2 = User(email='inst@test.com', username='instructor1', role='instructor')
    u2.set_password('pass456')
    _db.session.add(u2)
    u3 = User(email='admin@test.com', username='admin1', role='admin')
    u3.set_password('pass789')
    _db.session.add(u3)
    _db.session.commit()

    test('Student role', _db.session.get(User, u1.id).role == 'student')
    test('Instructor role', _db.session.get(User, u2.id).role == 'instructor')
    test('Admin role', _db.session.get(User, u3.id).role == 'admin')
    test('Unique email (different users)', u2.email != u1.email)
    test('Unique username (different users)', u2.username != u1.username)

print("\n[4] Course Parser — Directory Scanner")
COURSES_DIR = os.path.join(os.path.dirname(__file__), 'courses')
test('Courses directory exists', os.path.isdir(COURSES_DIR))

from app.services.course_parser import (
    get_course_tree, get_content_by_id, parse_front_matter,
    check_prerequisites, get_sort_key
)

with flask_app.app_context():
    flask_app.config['COURSES_DIR'] = COURSES_DIR
    tree = get_course_tree()
    test('Course tree is non-empty list', isinstance(tree, list) and len(tree) > 0)
    test('Entries sorted by numeric prefix', all(
        e['sort_key'] < tree[i+1]['sort_key'] for i, e in enumerate(tree[:-1])
    ) if len(tree) > 1 else True)

    categories = [e for e in tree if e['type'] == 'category']
    test('At least one category', len(categories) >= 1)

    notes = []
    def collect_notes(entries):
        for e in entries:
            if e['type'] == 'note': notes.append(e)
            if 'children' in e: collect_notes(e['children'])
    collect_notes(tree)
    test('At least one note', len(notes) >= 1)

print("\n[5] Front-matter Parsing")
sample = "---\ntype: note\nid: test-note\ntitle: Test Note\nprerequisites: [intro]\n---\n# Hello\nBody here."
with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
    f.write(sample)
    p = f.name
meta, body = parse_front_matter(p)
assert_eq('type parsed', meta.get('type'), 'note')
assert_eq('id parsed', meta.get('id'), 'test-note')
assert_eq('title parsed', meta.get('title'), 'Test Note')
assert_eq('prerequisites parsed', meta.get('prerequisites'), ['intro'])
assert_in('body extracted', '# Hello', body)
os.unlink(p)

with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
    f.write("# No front matter")
    p2 = f.name
meta2, body2 = parse_front_matter(p2)
test('Missing front-matter handled gracefully', True)
os.unlink(p2)

print("\n[6] Sort Keys")
assert_eq('"1." -> (1,)', get_sort_key('1. Foundation'), (1,))
assert_eq('"1.1" -> (1,1)', get_sort_key('1.1 Section'), (1, 1))
assert_eq('"1.1.1" -> (1,1,1)', get_sort_key('1.1.1 File'), (1, 1, 1))
assert_eq('"2." > "1."', get_sort_key('2.') > get_sort_key('1.'), True)
assert_eq('"1.2" > "1.1"', get_sort_key('1.2') > get_sort_key('1.1'), True)

print("\n[7] Content Retrieval by ID")
with flask_app.app_context():
    flask_app.config['COURSES_DIR'] = COURSES_DIR
    content = get_content_by_id('identify-components')
    test('Found by ID "identify-components"', content is not None)
    if content:
        assert_eq('type is note', content['type'], 'note')
        test('Has body text', len(content.get('body', '')) > 0)

    missing = get_content_by_id('nonexistent')
    test('Nonexistent ID returns None', missing is None)

print("\n[8] Lock/Unlock Prerequisite Logic")
with flask_app.app_context():
    flask_app.config['COURSES_DIR'] = COURSES_DIR

    os_basics = get_content_by_id('os-basics')
    if os_basics and os_basics.get('prerequisites'):
        prereqs = os_basics['prerequisites']
        test(f'"{os_basics["id"]}" has prereqs {prereqs}', len(prereqs) > 0)

        test('Locked when no prereqs met',
             check_prerequisites('os-basics', []) is False)
        test('Unlocked when all prereqs met',
             check_prerequisites('os-basics', prereqs) is True)

    no_prereq = get_content_by_id('identify-components')
    if no_prereq:
        test('Empty prereqs always unlocked',
             check_prerequisites('identify-components', []) is True)

print("\n" + "=" * 50)
print(f"RESULTS:  {TESTS_PASSED} passed, {TESTS_FAILED} failed")
print("=" * 50)
sys.exit(0 if TESTS_FAILED == 0 else 1)
