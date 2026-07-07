import json
from datetime import date, timedelta
from flask import Blueprint, jsonify, request
from flask_login import login_required, current_user
from .. import db
from ..models.progress import Progress
from ..models.badge import Badge, UserBadge, ActivityLog
from ..services.course_parser import get_content_by_id
from ..services.validator import get_validator

progress_api = Blueprint('progress_api', __name__, url_prefix='/api/progress')

validate_api = Blueprint('validate_api', __name__, url_prefix='/api')


@validate_api.route('/validate', methods=['POST'])
@login_required
def validate_code():
    """Validate student code against a rule.

    Request body:
        { "rule": "check_head_tag", "code": "<html>..." }

    Response:
        { "passed": true, "hint": "" }
    """
    data = request.get_json()
    if not data:
        return jsonify({'passed': False, 'hint': 'No data provided'}), 400

    rule = data.get('rule', '')
    code = data.get('code', '')

    if not rule:
        return jsonify({'passed': False, 'hint': 'No rule provided'}), 400

    validator = get_validator()
    passed, hint = validator.resolve_and_validate(rule, code)
    return jsonify({'passed': passed, 'hint': hint})

@progress_api.route('/<content_id>', methods=['GET'])
@login_required
def get_progress(content_id):
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
        'code': p.submission,
    })


@progress_api.route('/<content_id>/step', methods=['POST'])
@login_required
def save_step(content_id):
    data = request.get_json()
    step_index = data.get('step_index', 0)
    code = data.get('code', '')

    p = Progress.query.filter_by(
        user_id=current_user.id, content_id=content_id
    ).first()
    if not p:
        p = Progress(
            user_id=current_user.id,
            content_id=content_id,
            content_type='workshop',
            step_index=step_index,
            submission=code,
        )
        db.session.add(p)
    else:
        p.step_index = step_index
        if code:
            p.submission = code

    db.session.commit()
    return jsonify({'step_index': p.step_index})


@progress_api.route('/<content_id>/complete', methods=['POST'])
@login_required
def complete_content(content_id):
    data = request.get_json() or {}

    p = Progress.query.filter_by(
        user_id=current_user.id, content_id=content_id
    ).first()
    if not p:
        p = Progress(
            user_id=current_user.id,
            content_id=content_id,
            content_type=data.get('content_type', 'note'),
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

    # Log activity for contribution graph
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

    # Check and award badges
    _check_badges(current_user.id)

    return jsonify({'completed': True})


@progress_api.route('/<content_id>/submit', methods=['POST'])
@login_required
def submit_project(content_id):
    data = request.get_json()
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


@progress_api.route('/<content_id>/verdict', methods=['POST'])
@login_required
def set_verdict(content_id):
    if current_user.role not in ('instructor', 'admin'):
        return jsonify({'error': 'Unauthorized'}), 403

    data = request.get_json()
    verdict = data.get('verdict')
    user_id = data.get('user_id')

    p = Progress.query.filter_by(
        user_id=user_id, content_id=content_id
    ).first()
    if p:
        p.verdict = verdict
        if verdict == 'passed':
            p.completed = True
        db.session.commit()
        return jsonify({'verdict': p.verdict})

    return jsonify({'error': 'Not found'}), 404


def _check_badges(user_id):
    from ..models.admin import Certificate
    badges = Badge.query.filter_by(enabled=True).all()
    for badge in badges:
        existing = UserBadge.query.filter_by(user_id=user_id, badge_id=badge.id).first()
        if existing:
            continue
        try:
            cfg = json.loads(badge.config) if isinstance(badge.config, str) else badge.config
        except (json.JSONDecodeError, TypeError):
            cfg = {}
        earned = False

        if badge.badge_type == 'streak':
            min_streak = cfg.get('min_streak', 0)
            streak = _get_current_streak(user_id)
            if streak >= min_streak:
                earned = True

        elif badge.badge_type == 'course_completion':
            required = cfg.get('course_ids', [])
            completed_ids = set()
            for p in Progress.query.filter_by(user_id=user_id, completed=True).all():
                completed_ids.add(p.content_id)
            if all(cid in completed_ids for cid in required):
                earned = True

        elif badge.badge_type == 'combo':
            required = cfg.get('course_ids', [])
            deadline_str = cfg.get('deadline', '')
            completed_ids = set()
            for p in Progress.query.filter_by(user_id=user_id, completed=True).all():
                completed_ids.add(p.content_id)
            if all(cid in completed_ids for cid in required):
                if deadline_str:
                    try:
                        from datetime import datetime as dt
                        deadline = dt.strptime(deadline_str, '%Y-%m-%d').date()
                        if date.today() <= deadline:
                            earned = True
                    except ValueError:
                        earned = True
                else:
                    earned = True

        elif badge.badge_type == 'certificate':
            required_certs = cfg.get('certificate_ids', [])
            user_certs = set()
            for c in Certificate.query.filter_by(user_id=user_id).all():
                user_certs.add(c.category_id)
            if all(cid in user_certs for cid in required_certs):
                earned = True

        elif badge.badge_type == 'events':
            event_type = cfg.get('event_type', '')
            if event_type == 'first_certificate':
                cert_count = Certificate.query.filter_by(user_id=user_id).count()
                if cert_count >= 1:
                    earned = True
            elif event_type == 'first_completion':
                completed_count = Progress.query.filter_by(user_id=user_id, completed=True).count()
                if completed_count >= 1:
                    earned = True
            elif event_type == 'ten_completions':
                completed_count = Progress.query.filter_by(user_id=user_id, completed=True).count()
                if completed_count >= 10:
                    earned = True
            elif event_type == 'all_courses':
                from ..services.course_parser import load_structure
                structure = load_structure()
                all_ids = set(k for k, v in structure.items() if v.get('type') not in ('category', 'note'))
                completed_ids = set()
                for p in Progress.query.filter_by(user_id=user_id, completed=True).all():
                    completed_ids.add(p.content_id)
                if all_ids and all_ids.issubset(completed_ids):
                    earned = True

        if earned:
            ub = UserBadge(user_id=user_id, badge_id=badge.id)
            db.session.add(ub)
            db.session.commit()


def _get_current_streak(user_id):
    from datetime import date, timedelta
    today = date.today()
    streak = 0
    current = today
    while True:
        log = ActivityLog.query.filter_by(user_id=user_id, date=current).first()
        if log and log.count > 0:
            streak += 1
            current -= timedelta(days=1)
        else:
            break
    return streak


# ---- Public Badge & Activity APIs ----

@progress_api.route('/badges', methods=['GET'])
@login_required
def my_badges():
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


@progress_api.route('/activity', methods=['GET'])
@login_required
def my_activity():
    today = date.today()
    start = today - timedelta(days=365)
    logs = ActivityLog.query.filter(
        ActivityLog.user_id == current_user.id,
        ActivityLog.date >= start,
    ).all()
    result = {}
    for log in logs:
        result[log.date.isoformat()] = {'count': log.count, 'content_ids': log.content_ids}
    return jsonify(result)


@progress_api.route('/streak', methods=['GET'])
@login_required
def my_streak():
    streak = _get_current_streak(current_user.id)
    return jsonify({'streak': streak})
