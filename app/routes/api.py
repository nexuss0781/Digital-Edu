import os
import time
from datetime import date
from flask import Blueprint, jsonify, request, current_app
from flask_login import login_user, logout_user, login_required, current_user
from werkzeug.security import check_password_hash

from .. import db
from ..models.user import User
from ..models.progress import Progress
from ..models.badge import Badge, UserBadge, ActivityLog
from ..models.admin import Certificate, Restriction
from ..models.review import Review
from ..services.course_parser import (
    get_course_tree, get_content_by_id, check_item_locked,
    get_breadcrumb, get_all_content_ids,
    get_structure_version,
    _get_course_overview, _get_course_references,
)
import re
from ..services.assessment_parser import parse_content, _parse_fcc_lecture, _parse_fcc_test_questions
from ..services.asset_manifest import rewrites_for

api_bp = Blueprint('api', __name__, url_prefix='/api/v1')


def _get_current_streak(user_id):
    today = date.today()
    streak = 0
    current = today
    while True:
        log = ActivityLog.query.filter_by(user_id=user_id, date=current).first()
        if log and log.count > 0:
            streak += 1
            current -= __import__('datetime').timedelta(days=1)
        else:
            break
    return streak


def _count_lessons(entries):
    total = 0
    for e in entries:
        if e.get('type') != 'category':
            total += 1
        elif 'children' in e:
            total += _count_lessons(e['children'])
    return total


def _count_completed(entries, completed_ids):
    total = 0
    for e in entries:
        if e.get('type') != 'category' and e.get('id') in completed_ids:
            total += 1
        elif 'children' in e:
            total += _count_completed(e['children'], completed_ids)
    return total


# ────────────────────────────────────────────
# Auth
# ────────────────────────────────────────────

@api_bp.route('/auth/me', methods=['GET'])
def auth_me():
    if current_user.is_authenticated:
        return jsonify({**current_user.to_dict(), 'authenticated': True})
    return jsonify({'authenticated': False})


@api_bp.route('/auth/login', methods=['POST'])
def auth_login():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    email = data.get('email', '').strip()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'error': 'Email and password are required'}), 400

    user = User.query.filter_by(email=email).first()
    if not user or not user.check_password(password):
        return jsonify({'error': 'Invalid email or password'}), 401

    login_user(user)
    return jsonify({**user.to_dict(), 'authenticated': True})


@api_bp.route('/auth/register', methods=['POST'])
def auth_register():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    email = data.get('email', '').strip()
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not email or not username or not password:
        return jsonify({'error': 'Email, username, and password are required'}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email already registered'}), 409

    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already taken'}), 409

    role = data.get('role', 'student')
    if role == 'admin':
        role = 'instructor'

    user = User(email=email, username=username, role=role)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    login_user(user)
    return jsonify({**user.to_dict(), 'authenticated': True}), 201


@api_bp.route('/auth/logout', methods=['POST'])
def auth_logout():
    logout_user()
    return jsonify({'message': 'Logged out'})


# ────────────────────────────────────────────
# Courses
# ────────────────────────────────────────────

@api_bp.route('/courses', methods=['GET'])
def api_courses():
    from ..routes.courses import _compute_locked

    course_tree = get_course_tree()
    completed_ids = []
    if current_user.is_authenticated:
        completed = Progress.query.filter_by(
            user_id=current_user.id, completed=True
        ).all()
        completed_ids = [p.content_id for p in completed]

    locked_ids = set(_compute_locked(course_tree, completed_ids))

    courses = []
    for entry in course_tree:
        if entry.get('type') != 'category':
            continue

        children = entry.get('children', [])
        total = _count_lessons(children)

        completed_count = 0
        locked_count = 0
        for e in children:
            eid = e.get('id')
            if e.get('type') != 'category':
                if eid in completed_ids:
                    completed_count += 1
                if eid in locked_ids:
                    locked_count += 1

        progress_pct = round((completed_count / total * 100) if total > 0 else 0)

        courses.append({
            'id': entry.get('id'),
            'name': entry.get('title') or entry.get('name', 'Untitled'),
            'description': entry.get('description', ''),
            'image': entry.get('image', ''),
            'total': total,
            'completed_count': completed_count,
            'locked_count': locked_count,
            'progress_pct': progress_pct,
            'category_type': entry.get('category_type', 'category'),
            'level': entry.get('level', ''),
            'expected_hours': entry.get('expected_hours', ''),
            'path': entry.get('path', ''),
        })

    return jsonify(courses)


@api_bp.route('/courses/<path:content_id>', methods=['GET'])
def api_course_detail(content_id):
    from ..routes.courses import _compute_locked

    content = get_content_by_id(content_id)
    if not content:
        return jsonify({'error': 'Not found'}), 404

    if content.get('type') != 'category':
        return jsonify({'error': 'Not a category'}), 400

    course_tree = get_course_tree()
    completed_ids = []
    if current_user.is_authenticated:
        completed = Progress.query.filter_by(
            user_id=current_user.id, completed=True
        ).all()
        completed_ids = [p.content_id for p in completed]

    locked_ids = set(_compute_locked(course_tree, completed_ids))

    children = content.get('children', [])
    total = _count_lessons(children)
    completed_count = _count_completed(children, completed_ids)
    progress_pct = round((completed_count / total * 100) if total > 0 else 0)

    section_count = sum(1 for c in children if c.get('type') == 'category')

    return jsonify({
        'id': content.get('id'),
        'name': content.get('title') or content.get('name', 'Untitled'),
        'description': content.get('description', ''),
        'image': content.get('image', ''),
        'total': total,
        'completed_count': completed_count,
        'progress_pct': progress_pct,
        'section_count': section_count,
        'level': content.get('level', 'Beginner'),
        'expected_hours': content.get('expected_hours', ''),
        'path': content.get('path', ''),
    })


@api_bp.route('/meta/version', methods=['GET'])
def api_structure_version():
    """Cheap endpoint so the frontend can detect course-structure changes
    (hidden items, locks, renames) without re-downloading every tree."""
    return jsonify({'version': get_structure_version()})


@api_bp.route('/courses/<path:content_id>/curriculum', methods=['GET'])
def api_curriculum(content_id):
    from ..routes.courses import _compute_locked

    content = get_content_by_id(content_id)
    if not content:
        return jsonify({'error': 'Not found'}), 404

    if content.get('type') != 'category':
        return jsonify({'error': 'Not a category'}), 400

    course_tree = get_course_tree()
    completed_ids = []
    if current_user.is_authenticated:
        completed = Progress.query.filter_by(
            user_id=current_user.id, completed=True
        ).all()
        completed_ids = [p.content_id for p in completed]

    locked_ids = set(_compute_locked(course_tree, completed_ids))
    completed_set = set(completed_ids)

    progress_map = {}
    if current_user.is_authenticated:
        for p in Progress.query.filter_by(user_id=current_user.id).all():
            progress_map[p.content_id] = p

    def build_node(entry, depth=0):
        node = {
            'id': entry.get('id'),
            'name': entry.get('title') or entry.get('name', 'Untitled'),
            'type': entry.get('type'),
            'depth': depth,
            'locked': entry.get('id') in locked_ids,
            'completed': entry.get('id') in completed_set,
        }
        if entry.get('type') == 'category':
            children = entry.get('children', [])
            built = []
            total = 0
            completed_total = 0
            for c in children:
                child, t, ct = build_node(c, depth + 1)
                built.append(child)
                total += t
                completed_total += ct
            node['total'] = total
            node['completed_count'] = completed_total
            node['children'] = built
            return node, total, completed_total
        node['content_type'] = entry.get('type')
        if entry.get('type') == 'workshop':
            node['step_count'] = entry.get('step_count', 0)
            p = progress_map.get(entry.get('id'))
            node['step_index'] = (p.step_index or 0) if p else 0
        return node, 1, (1 if entry.get('id') in completed_set else 0)

    root, _, _ = build_node(content)
    root['version'] = get_structure_version()
    return jsonify(root)


@api_bp.route('/courses/<path:content_id>/overview', methods=['GET'])
def api_overview(content_id):
    content = get_content_by_id(content_id)
    if not content or content.get('type') != 'category':
        return jsonify({'html': ''})
    cat_path = content.get('path', '')
    if cat_path:
        cat_path = os.path.dirname(cat_path)
    html = _get_course_overview(cat_path)
    return jsonify({'html': html})


@api_bp.route('/courses/<path:content_id>/references', methods=['GET'])
def api_references(content_id):
    content = get_content_by_id(content_id)
    if not content or content.get('type') != 'category':
        return jsonify({'references': []})
    cat_path = content.get('path', '')
    if cat_path:
        cat_path = os.path.dirname(cat_path)
    refs = _get_course_references(cat_path)
    return jsonify({'references': refs})


@api_bp.route('/courses/<path:content_id>/reviews', methods=['POST'])
@login_required
def api_post_review(content_id):
    content = get_content_by_id(content_id)
    if not content:
        return jsonify({'error': 'Course not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    rating = data.get('rating')
    comment = data.get('comment', '').strip()

    if not rating:
        return jsonify({'error': 'Rating is required'}), 400

    try:
        rating = int(rating)
    except (TypeError, ValueError):
        return jsonify({'error': 'Rating must be an integer'}), 400

    if rating < 1 or rating > 5:
        return jsonify({'error': 'Rating must be between 1 and 5'}), 400

    review = Review(
        course_id=content_id,
        user_id=current_user.id,
        username=current_user.username,
        rating=rating,
        comment=comment,
    )
    db.session.add(review)
    db.session.commit()
    return jsonify(review.to_dict()), 201


@api_bp.route('/courses/<path:content_id>/reviews', methods=['GET'])
def api_get_reviews(content_id):
    course_reviews = Review.query.filter_by(course_id=content_id).order_by(Review.id.desc()).all()
    return jsonify([r.to_dict() for r in course_reviews])


# ────────────────────────────────────────────
# Content
# ────────────────────────────────────────────


def _lab_course_root(content):
    path = content.get('path', '')
    return path.split('/')[0] if path else ''


def _content_rewrites(content):
    """Compute remote->local asset rewrites for a content payload."""
    root = _lab_course_root(content)
    if not root:
        return []
    parts = []
    for sf in content.get('seed_files', []):
        parts.append(sf.get('code', ''))
    if content.get('seed'):
        parts.append(content.get('seed'))
    parts.extend([
        content.get('description', ''),
        content.get('body', ''),
        content.get('solution', ''),
    ])
    for step in content.get('steps', []):
        if isinstance(step, dict):
            parts.append(step.get('description', ''))
            parts.append(step.get('seed', ''))
            for sf in step.get('seed_files', []):
                if isinstance(sf, dict):
                    parts.append(sf.get('code', ''))
    return rewrites_for(
        current_app.config.get('COURSES_DIR', 'courses'),
        root,
        '\n'.join(parts),
    )


def _lab_asset_base(content):
    root = _lab_course_root(content)
    if not root:
        return ''
    return f'/api/v1/course-file/{root}/assets'


def _lab_assets(content):
    """List image/audio assets referenced by a lab's seed so students know the location."""
    root = _lab_course_root(content)
    if not root:
        return []
    base = f'/api/v1/course-file/{root}/assets'
    pattern = re.compile(r'\.\./assets/([A-Za-z0-9._-]+)')
    found = []
    for sf in content.get('seed_files', []):
        for name in pattern.findall(sf.get('code', '')):
            if name not in found:
                found.append(name)
    import mimetypes
    ext_type = {
        '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image',
        '.svg': 'image', '.webp': 'image',
        '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio',
        '.mp4': 'video', '.webm': 'video',
        '.vtt': 'subtitles', '.txt': 'text', '.pdf': 'pdf',
    }
    assets = []
    for name in found:
        ext = os.path.splitext(name)[1].lower()
        assets.append({'name': name, 'url': f'{base}/{name}', 'type': ext_type.get(ext, 'file')})
    return assets


@api_bp.route('/course-file/<path:relpath>', methods=['GET'])
def api_course_file(relpath):
    """Serve a file from the courses directory (used by lab asset URLs)."""
    from flask import send_file
    import mimetypes

    courses_dir = os.path.abspath(current_app.config['COURSES_DIR'])
    target = os.path.abspath(os.path.join(courses_dir, relpath))
    if os.path.commonpath([courses_dir, target]) != courses_dir or not os.path.isfile(target):
        return jsonify({'error': 'Not found'}), 404
    mime, _ = mimetypes.guess_type(target)
    return send_file(target, mimetype=mime or 'application/octet-stream')


@api_bp.route('/content/<path:content_id>', methods=['GET'])
def api_content(content_id):
    from ..routes.courses import _compute_locked

    content = get_content_by_id(content_id)
    if not content:
        return jsonify({'error': 'Not found'}), 404

    config = content.get('config', {})
    if check_item_locked(config):
        return jsonify({'error': 'Content is locked'}), 403

    completed_ids = []
    locked_ids = []
    if current_user.is_authenticated:
        if Restriction.query.filter_by(user_id=current_user.id, content_id=content_id).first():
            return jsonify({'error': 'Content is restricted for your account'}), 403

        completed = Progress.query.filter_by(
            user_id=current_user.id, completed=True
        ).all()
        completed_ids = [p.content_id for p in completed]
        prereqs = content.get('prerequisites', [])
        if prereqs and not all(pid in completed_ids for pid in prereqs):
            return jsonify({'error': 'Prerequisites not met'}), 403

        course_tree = get_course_tree()
        locked_ids = list(_compute_locked(course_tree, completed_ids))

    body = content.get('body', '')
    lecture_data = {}
    test_data = {}

    is_parent_workshop = content.get('parent') and content.get('type') == 'workshop'

    if is_parent_workshop:
        steps = content.get('steps', [])
        assessments = [{'type': 'workshop', 'steps': steps}]
        breadcrumb = get_breadcrumb(content_id)
        seed = content.get('seed', '')
        return jsonify({
            'id': content.get('id'),
            'name': content.get('title') or content.get('name', 'Untitled'),
            'type': content.get('type'),
            'body': body,
            'assessments': assessments,
            'breadcrumb': breadcrumb,
            'locked': content.get('id') in locked_ids if locked_ids else False,
            'completed': content.get('id') in completed_ids,
            'seed': seed,
            'step_count': content.get('step_count', len(steps)),
            'rewrites': _content_rewrites(content),
        })

    assessments = parse_content(content.get('type', 'lecture'), body)
    breadcrumb = get_breadcrumb(content_id)

    if content.get('type') == 'practical':
        lab = {
            'description': content.get('description', ''),
            'hints': content.get('hints', []),
            'seed_files': content.get('seed_files', []),
            'solution': content.get('solution', ''),
            'assets': _lab_assets(content),
            'asset_base': _lab_asset_base(content),
            'rewrites': _content_rewrites(content),
        }
        return jsonify({
            'id': content.get('id'),
            'name': content.get('title') or content.get('name', 'Untitled'),
            'type': content.get('type'),
            'body': lab['description'],
            'assessments': [{'type': 'lab', 'hints': lab['hints']}],
            'breadcrumb': breadcrumb,
            'locked': content.get('id') in locked_ids if locked_ids else False,
            'completed': content.get('id') in completed_ids,
            'lab': lab,
        })

    if content.get('type') in ('lecture', 'review'):
        lecture_data = _parse_fcc_lecture(body)
        body = lecture_data.get('content_section', body)
    elif content.get('type') in ('test', 'exam'):
        fcc_questions = _parse_fcc_test_questions(body)
        desc_m = re.search(r'^# --description--\s*\n(.*?)(?=^# --)', body, re.MULTILINE | re.DOTALL)
        description = desc_m.group(1).strip() if desc_m else ''
        thresh_m = re.search(r'at least (\d+) of', description)
        pass_threshold = int(thresh_m.group(1)) if thresh_m else len(fcc_questions)
        test_data = {
            'description': description,
            'question_count': len(fcc_questions),
            'pass_threshold': pass_threshold,
        }
        body = re.sub(r'^# --description--\s*$', '', body, flags=re.MULTILINE)
        body = re.sub(r'^# --quizzes--.*$', '', body, flags=re.MULTILINE | re.DOTALL).strip()

    body = re.sub(r'^# --assignment--\s*\n?', '', body, flags=re.MULTILINE)
    body = re.sub(r'^# --instructions--\s*\n?', '', body, flags=re.MULTILINE).strip()

    return jsonify({
        'id': content.get('id'),
        'name': content.get('title') or content.get('name', 'Untitled'),
        'type': content.get('type'),
        'body': body,
        'assessments': assessments,
        'breadcrumb': breadcrumb,
        'locked': content.get('id') in locked_ids if locked_ids else False,
        'completed': content.get('id') in completed_ids,
        'lecture_data': lecture_data,
        'test_data': test_data,
        'rewrites': _content_rewrites(content),
    })


# ────────────────────────────────────────────
# Learn (next challenge)
# ────────────────────────────────────────────

@api_bp.route('/learn', methods=['GET'])
@login_required
def api_learn_next():
    """Return the first uncompleted, unlocked challenge in course order.

    Works for both a fresh student (returns the very first challenge) and a
    returning one (jumps every completed item). Returns {done: true} when the
    whole course is finished.
    """
    from ..routes.courses import _compute_locked

    course_tree = get_course_tree()
    completed = Progress.query.filter_by(
        user_id=current_user.id, completed=True
    ).all()
    completed_ids = [p.content_id for p in completed]
    locked_ids = set(_compute_locked(course_tree, completed_ids))

    stack = list(reversed(course_tree))
    while stack:
        entry = stack.pop()
        if entry.get('type') == 'category':
            stack.extend(reversed(entry.get('children', [])))
            continue
        cid = entry.get('id')
        if cid in completed_ids or cid in locked_ids:
            continue
        if entry.get('type') == 'note':
            continue
        return jsonify({
            'id': cid,
            'name': entry.get('title') or entry.get('name', 'Untitled'),
            'type': entry.get('type'),
            'breadcrumb': get_breadcrumb(cid),
        })
    return jsonify({'done': True})


# ────────────────────────────────────────────
# Progress
# ────────────────────────────────────────────

@api_bp.route('/progress/<path:content_id>', methods=['GET'])
@login_required
def api_progress(content_id):
    p = Progress.query.filter_by(
        user_id=current_user.id, content_id=content_id
    ).first()
    if not p:
        return jsonify({'step_index': 0, 'completed': False})
    return jsonify({
        'step_index': p.step_index,
        'completed': p.completed,
        'score': p.score,
        'passed': p.passed,
        'verdict': p.verdict,
        'submission': p.submission,
    })


@api_bp.route('/progress/<path:content_id>/step', methods=['POST'])
@login_required
def api_save_step(content_id):
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    step_index = data.get('step_index', 0)
    code = data.get('code', '')
    content_type = data.get('content_type', 'workshop')

    p = Progress.query.filter_by(
        user_id=current_user.id, content_id=content_id
    ).first()
    if not p:
        p = Progress(
            user_id=current_user.id,
            content_id=content_id,
            content_type=content_type,
            step_index=step_index,
            submission=code,
        )
        db.session.add(p)
    else:
        p.step_index = step_index
        p.content_type = content_type
        if code:
            p.submission = code

    db.session.commit()
    return jsonify({'step_index': p.step_index})


@api_bp.route('/progress/<path:content_id>/complete', methods=['POST'])
@login_required
def api_complete_content(content_id):
    data = request.get_json() or {}

    p = Progress.query.filter_by(
        user_id=current_user.id, content_id=content_id
    ).first()
    if not p:
        p = Progress(
            user_id=current_user.id,
            content_id=content_id,
            content_type=data.get('content_type', 'lecture'),
            completed=True,
            score=data.get('score'),
            passed=data.get('passed'),
        )
        db.session.add(p)
    else:
        p.completed = True
        if data.get('score') is not None:
            p.score = data['score']
        if data.get('passed') is not None:
            p.passed = data['passed']

    db.session.commit()

    today = date.today()
    log = ActivityLog.query.filter_by(user_id=current_user.id, date=today).first()
    if log:
        log.count += 1
        ids = set(log.content_ids.split(',') if log.content_ids else [])
        ids.add(content_id)
        log.content_ids = ','.join(filter(None, ids))
    else:
        log = ActivityLog(user_id=current_user.id, date=today, count=1, content_ids=content_id)
        db.session.add(log)
    db.session.commit()

    from ..routes.progress_api import _check_badges
    _check_badges(current_user.id)

    content = get_content_by_id(content_id)
    if content:
        content_type = content.get('type', '')
        if content_type in ('quiz', 'test', 'exam') and data.get('passed'):
            from ..routes.progress_api import _unlock_next_pass
            _unlock_next_pass(content_id)

    return jsonify({'completed': True})


@api_bp.route('/progress/<path:content_id>/submit', methods=['POST'])
@login_required
def api_submit_project(content_id):
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    code = data.get('code', '')

    p = Progress.query.filter_by(
        user_id=current_user.id, content_id=content_id
    ).first()
    if not p:
        p = Progress(
            user_id=current_user.id,
            content_id=content_id,
            content_type='project',
            submission=code,
        )
        db.session.add(p)
    else:
        p.submission = code
        if p.verdict == 'retry':
            p.verdict = None
            p.completed = False

    db.session.commit()
    return jsonify({'submitted': True})


@api_bp.route('/progress/activity', methods=['GET'])
@login_required
def api_activity():
    today = date.today()
    start = today - __import__('datetime').timedelta(days=365)
    logs = ActivityLog.query.filter(
        ActivityLog.user_id == current_user.id,
        ActivityLog.date >= start,
    ).all()
    result = {}
    for log in logs:
        result[log.date.isoformat()] = {
            'count': log.count,
            'content_ids': log.content_ids,
        }
    return jsonify(result)


@api_bp.route('/progress/badges', methods=['GET'])
@login_required
def api_badges():
    user_badges = UserBadge.query.filter_by(user_id=current_user.id).all()
    result = []
    for ub in user_badges:
        b = ub.badge
        if b:
            result.append({
                'id': ub.id,
                'badge_id': b.id,
                'name': b.name,
                'description': b.description,
                'icon': b.icon,
                'awarded_at': ub.awarded_at.isoformat() if ub.awarded_at else None,
            })
    return jsonify(result)


@api_bp.route('/progress/streak', methods=['GET'])
@login_required
def api_streak():
    streak = _get_current_streak(current_user.id)
    return jsonify({'streak': streak})


# ────────────────────────────────────────────
# User
# ────────────────────────────────────────────

@api_bp.route('/user/profile', methods=['GET'])
@login_required
def api_profile():
    certificates = Certificate.query.filter_by(user_id=current_user.id).all()
    completed = Progress.query.filter_by(
        user_id=current_user.id, completed=True
    ).count()
    return jsonify({
        **current_user.to_dict(),
        'profile_visibility': current_user.profile_visibility,
        'bio': current_user.bio,
        'avatar': current_user.avatar,
        'certificate_count': len(certificates),
        'completed_count': completed,
    })


@api_bp.route('/user/settings', methods=['POST'])
@login_required
def api_settings():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    visibility = data.get('visibility', 'public')
    current_user.profile_visibility = visibility
    db.session.commit()
    return jsonify({'profile_visibility': current_user.profile_visibility})


@api_bp.route('/user/change-password', methods=['POST'])
@login_required
def api_change_password():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    current_pw = data.get('current_password', '')
    new_pw = data.get('new_password', '')
    confirm_pw = data.get('confirm_password', '')

    if not current_user.check_password(current_pw):
        return jsonify({'error': 'Current password is incorrect'}), 400

    if new_pw != confirm_pw:
        return jsonify({'error': 'New passwords do not match'}), 400

    if len(new_pw) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400

    current_user.set_password(new_pw)
    db.session.commit()
    return jsonify({'message': 'Password changed successfully'})
