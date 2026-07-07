"""
End-to-end test for Badge System + Contribution Graph.
Run: python3 test_badges_e2e.py
"""
import os
import sys
import json
import tempfile
import shutil
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ['FLASK_ENV'] = 'testing'

tmpdir = tempfile.mkdtemp()
test_db_path = os.path.join(os.path.dirname(__file__), 'instance', 'test_badges_e2e.db')
if os.path.exists(test_db_path):
    os.remove(test_db_path)
os.environ['COURSES_DIR'] = tmpdir
os.environ['DATABASE_URL'] = f'sqlite:///{test_db_path}'

from app import create_app
from app.models.user import User as UserModel
from app.models.progress import Progress
from app.models.badge import Badge, UserBadge, ActivityLog
from app.models.admin import Certificate, CertificateTemplate
from app.routes.progress_api import _get_current_streak, _check_badges

PASS = 0
FAIL = 0


def ok(name):
    global PASS
    PASS += 1
    print(f'  OK  {name}')


def fail(name, msg=''):
    global FAIL
    FAIL += 1
    print(f'  FAIL  {name}  -- {msg}')


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


def assert_gt(a, b, name):
    if a > b:
        ok(name)
    else:
        fail(name, f'expected {a} > {b}')


# ============================================================
# Create test content
# ============================================================
def create_course_content():
    # Minimal course files
    dirs = ['1. Foundation Introduction', 'os-basics', 'html-workshop']
    for d in dirs:
        os.makedirs(os.path.join(tmpdir, d), exist_ok=True)
    files = {
        '1. Foundation Introduction/_index.md': '---\ntitle: Foundation Introduction\ntype: note\n---\n\nWelcome.',
        'os-basics/note.md': '---\ntitle: OS Basics\ntype: quiz\n---\n\n<!-- questions -->\n* What is Linux?\n- A kernel\n- A browser\n- A game\n- A database\nAnswer: A\n* What is bash?\n- A shell\n- A desktop\n- A kernel\n- A file\nAnswer: A',
        'html-workshop/workshop.md': '---\ntitle: HTML Workshop\ntype: workshop\n---\n\n<!-- steps -->\n- prompt: echo hello\n  explanation: Say hello\n  expected: echo hello',
    }


# ============================================================
# TEST: Badge Creation (Admin)
# ============================================================
def test_badge_admin(client, app):
    print('\n--- BADGE ADMIN ---')

    with app.app_context():
        admin = UserModel(email='admin@test.com', username='admin', role='admin')
        admin.set_password('admin')
        db = app.extensions['sqlalchemy'].engine
        from app import db as db_orm
        db_orm.session.add(admin)
        db_orm.session.commit()

    # Login as admin via session
    with client.session_transaction() as sess:
        sess['_user_id'] = '1'
        sess['_fresh'] = True

    # Access badges page
    resp = client.get('/admin/badges')
    assert_eq(resp.status_code, 200, 'Badges page')

    # Create badges of each type
    badge_types = [
        ('streak', {'min_streak': 3}, 'Streak Badge'),
        ('course_completion', {'course_ids': ['os-basics']}, 'Course Badge'),
        ('combo', {'course_ids': ['os-basics', 'html-workshop'], 'deadline': '2099-12-31'}, 'Combo Badge'),
        ('certificate', {'certificate_ids': ['foundation-introduction']}, 'Cert Badge'),
        ('events', {'event_type': 'first_completion'}, 'First Step Badge'),
        ('events', {'event_type': 'ten_completions'}, 'Dedicated Badge'),
        ('events', {'event_type': 'all_courses'}, 'All Courses Badge'),
        ('events', {'event_type': 'first_certificate'}, 'First Cert Badge'),
    ]
    created_ids = []
    for btype, cfg, name in badge_types:
        resp = client.post('/admin/api/badges', json={
            'name': name,
            'description': f'Awarded for {name.lower()}',
            'icon': 'award',
            'badge_type': btype,
            'config': cfg,
            'enabled': True,
        })
        assert_eq(resp.status_code, 200, f'Create {name}')
        data = resp.get_json()
        assert_true(data.get('ok'), f'{name} created ok')
        created_ids.append(data['id'])

    # List badges
    resp = client.get('/admin/api/badges')
    assert_eq(resp.status_code, 200, 'List badges')
    badges = resp.get_json()
    assert_eq(len(badges), 8, '8 badges created')

    # Toggle badge
    resp = client.post(f'/admin/api/badges/{created_ids[0]}/toggle')
    assert_eq(resp.status_code, 200, 'Toggle badge')
    data = resp.get_json()
    assert_false(data['enabled'], 'Badge disabled after toggle')

    # Re-enable
    resp = client.post(f'/admin/api/badges/{created_ids[0]}/toggle')
    assert_eq(resp.status_code, 200, 'Re-enable badge')
    data = resp.get_json()
    assert_true(data['enabled'], 'Badge re-enabled')

    # Update badge
    resp = client.put(f'/admin/api/badges/{created_ids[0]}', json={
        'name': 'Updated Streak Badge',
        'description': 'Updated description',
    })
    assert_eq(resp.status_code, 200, 'Update badge')

    # Award badge manually
    with app.app_context():
        from app import db as db_orm
        user = UserModel(email='student@test.com', username='student', role='student')
        user.set_password('test')
        db_orm.session.add(user)
        db_orm.session.commit()
        uid = user.id

    resp = client.post('/admin/api/badges/award', json={
        'user_id': uid,
        'badge_id': created_ids[0],
    })
    assert_eq(resp.status_code, 200, 'Award badge manually')
    data = resp.get_json()
    assert_true(data.get('ok'), 'Manual award ok')

    # Duplicate award should fail
    resp = client.post('/admin/api/badges/award', json={
        'user_id': uid,
        'badge_id': created_ids[0],
    })
    assert_eq(resp.status_code, 409, 'Duplicate award blocked')

    return created_ids, uid


# ============================================================
# TEST: Auto Badge Awarding Logic
# ============================================================
def test_auto_badge_awarding(app, client):
    print('\n--- AUTO BADGE AWARDING ---')

    with app.app_context():
        from app import db as db_orm

        # Create activity logs for streak test (simulate 5-day streak)
        today = date.today()
        for i in range(5):
            d = today - timedelta(days=i)
            log = ActivityLog(user_id=2, date=d, count=1, content_ids='os-basics')
            db_orm.session.add(log)
        db_orm.session.commit()

        # Check streak
        streak = _get_current_streak(2)
        assert_eq(streak, 5, '5-day streak detected')

        # Create progress for course completion badge
        p = Progress(user_id=2, content_id='os-basics', content_type='quiz', completed=True)
        db_orm.session.add(p)
        db_orm.session.commit()

        # Run badge check
        _check_badges(2)
        db_orm.session.commit()

        # Verify badges awarded
        user_badges = UserBadge.query.filter_by(user_id=2).all()
        badge_names = {ub.badge.name for ub in user_badges if ub.badge}
        assert_true('Updated Streak Badge' in badge_names, 'Streak badge auto-awarded')
        assert_true('Course Badge' in badge_names, 'Course completion badge auto-awarded')
        assert_true('First Step Badge' in badge_names, 'First step badge auto-awarded')

        # Add more completions for dedicated badge
        for cid in ['html-workshop', 'extra-1', 'extra-2', 'extra-3',
                     'extra-4', 'extra-5', 'extra-6', 'extra-7', 'extra-8']:
            p = Progress(user_id=2, content_id=cid, content_type='note', completed=True)
            db_orm.session.add(p)
        db_orm.session.commit()

        # Also create a certificate for first_certificate badge
        cert = Certificate(user_id=2, category_id='foundation-introduction',
                           category_title='Foundation Introduction')
        db_orm.session.add(cert)
        db_orm.session.commit()

        _check_badges(2)
        db_orm.session.commit()

        user_badges2 = UserBadge.query.filter_by(user_id=2).all()
        badge_names2 = {ub.badge.name for ub in user_badges2 if ub.badge}
        assert_true('Dedicated Badge' in badge_names2, '10 completions badge auto-awarded')
        assert_true('First Cert Badge' in badge_names2, 'First certificate badge auto-awarded')


# ============================================================
# TEST: Activity API & Contribution Graph Data
# ============================================================
def test_activity_api(client):
    print('\n--- ACTIVITY API ---')

    # Login as student
    with client.session_transaction() as sess:
        sess['_user_id'] = '2'
        sess['_fresh'] = True

    # Get badges
    resp = client.get('/api/progress/badges')
    assert_eq(resp.status_code, 200, 'My badges API')
    badges = resp.get_json()
    assert_gt(len(badges), 0, 'Has earned badges')

    # Get streak
    resp = client.get('/api/progress/streak')
    assert_eq(resp.status_code, 200, 'Streak API')
    data = resp.get_json()
    assert_true(data['streak'] >= 5, f'Streak is {data["streak"]}')

    # Get activity
    resp = client.get('/api/progress/activity')
    assert_eq(resp.status_code, 200, 'Activity API')
    activity = resp.get_json()
    assert_gt(len(activity), 0, 'Has activity data')

    # Check a date has data
    today = date.today()
    key = today.isoformat()
    assert_true(key in activity, 'Today has activity entry')
    entry = activity[key]
    count = entry.get('count', entry) if isinstance(entry, dict) else entry
    assert_true(count >= 1, f'Activity count >= 1, got {count}')

    # Check content_ids includes os-basics
    if isinstance(entry, dict) and 'content_ids' in entry:
        assert_true('os-basics' in entry['content_ids'], 'Content ID recorded')


# ============================================================
# TEST: Profile Badges Display
# ============================================================
def test_profile_badges(client):
    print('\n--- PROFILE BADGES ---')

    # Login as student
    with client.session_transaction() as sess:
        sess['_user_id'] = '2'
        sess['_fresh'] = True

    resp = client.get('/profile')
    assert_eq(resp.status_code, 200, 'Profile page')
    assert_true(b'Badges' in resp.data, 'Badges section on profile')
    assert_true(b'Learning Activity' in resp.data, 'Activity section on profile')


# ============================================================
# TEST: Activity Logging on Completion
# ============================================================
def test_activity_on_complete(client, app):
    print('\n--- ACTIVITY ON COMPLETE ---')

    with client.session_transaction() as sess:
        sess['_user_id'] = '2'
        sess['_fresh'] = True

    # Complete a new content item
    resp = client.post('/api/progress/test-completion/complete', json={
        'content_type': 'note',
        'completed': True,
    })
    assert_eq(resp.status_code, 200, 'Complete content')

    # Verify activity logged
    with app.app_context():
        from app import db as db_orm
        today = date.today()
        log = ActivityLog.query.filter_by(user_id=2, date=today).first()
        assert_true(log is not None, 'Activity log created')
        assert_true(log.count >= 2, f'Count incremented to {log.count}')
        assert_true('test-completion' in log.content_ids, 'Content ID in log')

    # Verify streak still intact
    resp = client.get('/api/progress/streak')
    data = resp.get_json()
    assert_true(data['streak'] >= 5, f'Streak maintained: {data["streak"]}')


# ============================================================
# TEST: Disabled Badges Not Awarded
# ============================================================
def test_disabled_badge(app, client):
    print('\n--- DISABLED BADGE ---')

    # Login as admin
    with client.session_transaction() as sess:
        sess['_user_id'] = '1'
        sess['_fresh'] = True

    # Create a disabled badge
    resp = client.post('/admin/api/badges', json={
        'name': 'Disabled Test Badge',
        'badge_type': 'events',
        'config': {'event_type': 'first_completion'},
        'enabled': False,
    })
    assert_eq(resp.status_code, 200, 'Create disabled badge')

    # List badges verify disabled
    resp = client.get('/admin/api/badges')
    badges = resp.get_json()
    disabled = [b for b in badges if not b['enabled']]
    assert_true(len(disabled) >= 1, 'Disabled badge exists')

    # Run badge check - disabled should NOT be awarded
    with app.app_context():
        from app import db as db_orm
        badges_before = UserBadge.query.filter_by(user_id=2).count()
        _check_badges(2)
        db_orm.session.commit()
        badges_after = UserBadge.query.filter_by(user_id=2).count()
        # The disabled badge should not increase count (other badges might, but shouldn't add disabled)
        assert_true(badges_after >= badges_before, 'Badge count stable or increased')
        # Verify the disabled badge was not awarded
        dbadge = Badge.query.filter_by(name='Disabled Test Badge').first()
        awarded = UserBadge.query.filter_by(user_id=2, badge_id=dbadge.id).first()
        assert_true(awarded is None, 'Disabled badge not awarded')


# ============================================================
# TEST: Manual Badge Award via API
# ============================================================
def test_manual_award_api(client, app):
    print('\n--- MANUAL AWARD ---')

    with client.session_transaction() as sess:
        sess['_user_id'] = '1'
        sess['_fresh'] = True

    # Create a simple badge
    resp = client.post('/admin/api/badges', json={
        'name': 'Manual Award Badge',
        'badge_type': 'events',
        'config': {'event_type': 'first_completion'},
        'enabled': True,
    })
    bid = resp.get_json()['id']

    # Award to user 2
    resp = client.post('/admin/api/badges/award', json={
        'user_id': 2,
        'badge_id': bid,
    })
    assert_eq(resp.status_code, 200, 'Manual award API')
    data = resp.get_json()
    assert_true(data.get('ok'), 'Manual award returned ok')

    # Verify user has it
    with app.app_context():
        from app import db as db_orm
        ub = UserBadge.query.filter_by(user_id=2, badge_id=bid).first()
        assert_true(ub is not None, 'Badge awarded to user')


# ============================================================
# TEST: Contribution Graph Data Integrity
# ============================================================
def test_contribution_graph_data(client):
    print('\n--- CONTRIBUTION GRAPH ---')

    with client.session_transaction() as sess:
        sess['_user_id'] = '2'
        sess['_fresh'] = True

    # Get activity data and verify structure
    resp = client.get('/api/progress/activity')
    data = resp.get_json()
    assert_true(isinstance(data, dict), 'Activity is dict')

    # Verify date keys are valid ISO format
    for key in list(data.keys())[:5]:
        try:
            date.fromisoformat(key)
        except ValueError:
            fail('Activity date format', f'Invalid date: {key}')
            break
    else:
        ok('Activity date format valid')

    # Verify max 365 days of data
    assert_true(len(data) <= 366, f'At most 366 days of data, got {len(data)}')


# ============================================================
# RUN
# ============================================================
if __name__ == '__main__':
    app = create_app()
    app.config['TESTING'] = True
    app.config['WTF_CSRF_ENABLED'] = False
    app.config['SERVER_NAME'] = 'localhost'

    with app.app_context():
        from app import db
        db.create_all()

    create_course_content()

    client = app.test_client()

    created_ids, uid = test_badge_admin(client, app)
    test_auto_badge_awarding(app, client)
    test_activity_api(client)
    test_profile_badges(client)
    test_activity_on_complete(client, app)
    test_disabled_badge(app, client)
    test_manual_award_api(client, app)
    test_contribution_graph_data(client)

    print(f'\n{"=" * 40}')
    print(f'  PASS: {PASS}  |  FAIL: {FAIL}')
    print(f'{"=" * 40}')

    # Cleanup
    if os.path.exists(test_db_path):
        os.remove(test_db_path)
    shutil.rmtree(tmpdir, ignore_errors=True)

    if FAIL > 0:
        sys.exit(1)
