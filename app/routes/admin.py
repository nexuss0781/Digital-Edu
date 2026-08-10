import json
import os
from datetime import datetime, timedelta
import yaml
from flask import Blueprint, request, jsonify, current_app, send_file
from flask_login import current_user
from .. import db
from ..models.user import User
from ..models.progress import Progress
from ..models.admin import Ban, Certificate, CertificateTemplate, Restriction
from ..models.badge import Badge, UserBadge, ActivityLog
from ..services.course_parser import (
    get_course_tree, get_content_by_id, capture_structure,
    load_structure, save_structure, build_structure_index,
    parse_front_matter, invalidate_cache,
)

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')


def admin_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_authenticated:
            return jsonify({'error': 'Authentication required'}), 401
        if current_user.role not in ('admin', 'instructor'):
            return jsonify({'error': 'Admin access required'}), 403
        return f(*args, **kwargs)
    return decorated


@admin_bp.route('/api/dashboard')
@admin_required
def api_dashboard():
    total_users = User.query.count()
    total_progress = Progress.query.count()
    completed = Progress.query.filter_by(completed=True).count()
    tree_index = build_structure_index()
    return jsonify({
        'total_users': total_users,
        'total_progress': total_progress,
        'completed': completed,
        'content_count': len(tree_index),
    })


@admin_bp.route('/api/structure', methods=['GET', 'POST'])
@admin_required
def api_structure():
    if request.method == 'POST':
        data = request.get_json()
        if data:
            save_structure(data)
            return jsonify({'ok': True})
    return jsonify(load_structure())


@admin_bp.route('/api/capture', methods=['POST'])
@admin_required
def api_capture():
    structure = capture_structure()
    return jsonify(structure)


@admin_bp.route('/api/update-item', methods=['POST'])
@admin_required
def api_update_item():
    data = request.get_json()
    item_id = data.get('id')
    updates = data.get('updates', {})
    structure = load_structure()
    if item_id not in structure:
        structure[item_id] = {}
    structure[item_id].update(updates)
    save_structure(structure)
    return jsonify({'ok': True})


@admin_bp.route('/api/batch-update', methods=['POST'])
@admin_required
def api_batch_update():
    data = request.get_json()
    ids = data.get('ids', [])
    updates = data.get('updates', {})
    structure = load_structure()
    for item_id in ids:
        if item_id not in structure:
            structure[item_id] = {}
        structure[item_id].update(updates)
    save_structure(structure)
    return jsonify({'ok': True})


@admin_bp.route('/api/users')
@admin_required
def api_users():
    search = request.args.get('q', '').strip()
    query = User.query
    if search:
        like = f'%{search}%'
        query = query.filter(
            db.or_(User.username.ilike(like), User.email.ilike(like))
        )
    users = query.order_by(User.id).all()
    result = []
    for u in users:
        completed = Progress.query.filter_by(user_id=u.id, completed=True).count()
        restriction_count = db.session.query(Restriction).filter_by(user_id=u.id).count()
        result.append({
            'id': u.id,
            'email': u.email,
            'username': u.username,
            'role': u.role,
            'banned': u.is_banned,
            'muted': u.is_muted,
            'completed': completed,
            'restriction_count': restriction_count,
            'date_joined': u.date_joined.isoformat() if u.date_joined else None,
        })
    return jsonify(result)


@admin_bp.route('/api/users/<int:user_id>/ban', methods=['POST'])
@admin_required
def api_ban_user(user_id):
    data = request.get_json()
    duration = data.get('duration')
    reason = data.get('reason', '')
    expires_at = None
    if duration:
        unit = data.get('unit', 'days')
        kwargs = {unit: int(duration)}
        expires_at = datetime.utcnow() + timedelta(**kwargs)

    ban = Ban(
        user_id=user_id,
        banned_by=current_user.id,
        reason=reason,
        expires_at=expires_at,
    )
    db.session.add(ban)
    db.session.commit()
    return jsonify({'ok': True})


@admin_bp.route('/api/users/<int:user_id>/unban', methods=['POST'])
@admin_required
def api_unban_user(user_id):
    bans = Ban.query.filter_by(user_id=user_id, active=True).all()
    for b in bans:
        b.active = False
    db.session.commit()
    return jsonify({'ok': True})


@admin_bp.route('/api/users/<int:user_id>/role', methods=['POST'])
@admin_required
def api_set_role(user_id):
    u = db.session.get(User, user_id)
    if not u:
        return jsonify({'error': 'User not found'}), 404
    data = request.get_json()
    role = data.get('role', 'student')
    if role not in ('student', 'admin', 'instructor'):
        return jsonify({'error': 'Invalid role'}), 400
    if role == 'admin':
        role = 'instructor'
    u.role = role
    db.session.commit()
    return jsonify({'ok': True, 'role': u.role})


@admin_bp.route('/api/users/<int:user_id>/mute', methods=['POST'])
@admin_required
def api_toggle_mute(user_id):
    u = db.session.get(User, user_id)
    if not u:
        return jsonify({'error': 'User not found'}), 404
    data = request.get_json() or {}
    muted = data.get('muted', not u.muted)
    u.muted = muted
    db.session.commit()
    return jsonify({'ok': True, 'muted': u.muted})


@admin_bp.route('/api/users/<int:user_id>/restrictions', methods=['GET', 'POST'])
@admin_required
def api_restrictions(user_id):
    u = db.session.get(User, user_id)
    if not u:
        return jsonify({'error': 'User not found'}), 404

    if request.method == 'POST':
        data = request.get_json() or {}
        content_ids = data.get('content_ids', [])

        old = Restriction.query.filter_by(user_id=user_id).all()
        for r in old:
            db.session.delete(r)

        for cid in content_ids:
            r = Restriction(user_id=user_id, content_id=cid, created_by=current_user.id)
            db.session.add(r)

        db.session.commit()
        return jsonify({'ok': True, 'count': len(content_ids)})

    restrictions = Restriction.query.filter_by(user_id=user_id).all()
    return jsonify([{'id': r.id, 'content_id': r.content_id, 'created_at': r.created_at.isoformat() if r.created_at else None} for r in restrictions])


@admin_bp.route('/api/submissions')
@admin_required
def api_submissions():
    projects = Progress.query.filter_by(content_type='project').filter(
        Progress.submission.isnot(None)
    ).all()
    result = []
    for p in projects:
        user = db.session.get(User, p.user_id)
        result.append({
            'id': p.id,
            'user_id': p.user_id,
            'username': user.username if user else 'Unknown',
            'content_id': p.content_id,
            'submission': p.submission,
            'verdict': p.verdict,
            'completed': p.completed,
        })
    return jsonify(result)


@admin_bp.route('/api/submissions/<int:progress_id>/verdict', methods=['POST'])
@admin_required
def api_submission_verdict(progress_id):
    data = request.get_json()
    verdict = data.get('verdict')
    p = db.session.get(Progress, progress_id)
    if p:
        p.verdict = verdict
        if verdict == 'passed':
            p.completed = True
        db.session.commit()
        return jsonify({'ok': True})
    return jsonify({'error': 'Not found'}), 404


@admin_bp.route('/api/certificate-templates', methods=['GET', 'POST'])
@admin_required
def api_cert_templates():
    if request.method == 'POST':
        data = request.get_json()
        tpl = CertificateTemplate(
            name=data.get('name', 'Untitled'),
            header=data.get('header', 'Certificate of Completion'),
            subtitle=data.get('subtitle', ''),
            description=data.get('description', ''),
            issuer=data.get('issuer', 'Digital-Edu'),
            footer=data.get('footer', ''),
        )
        db.session.add(tpl)
        db.session.commit()
        return jsonify({'id': tpl.id, 'ok': True})

    templates = CertificateTemplate.query.all()
    return jsonify([{
        'id': t.id,
        'name': t.name,
        'header': t.header,
        'subtitle': t.subtitle,
        'description': t.description,
        'issuer': t.issuer,
        'footer': t.footer,
    } for t in templates])


@admin_bp.route('/api/certificate-templates/<int:template_id>', methods=['PUT'])
@admin_required
def api_update_cert_template(template_id):
    tpl = db.session.get(CertificateTemplate, template_id)
    if not tpl:
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json()
    for field in ('name', 'header', 'subtitle', 'description', 'issuer', 'footer'):
        if field in data:
            setattr(tpl, field, data[field])
    db.session.commit()
    return jsonify({'ok': True})


@admin_bp.route('/api/award-certificate', methods=['POST'])
@admin_required
def api_award_certificate():
    data = request.get_json()
    user_id = data.get('user_id')
    category_id = data.get('category_id')
    category_title = data.get('category_title', '')
    subcategories = data.get('subcategory_ids', '')
    template_id = data.get('template_id')

    cert = Certificate(
        user_id=user_id,
        template_id=template_id,
        category_id=category_id,
        category_title=category_title,
        subcategory_ids=json.dumps(subcategories) if isinstance(subcategories, list) else subcategories,
    )
    db.session.add(cert)
    db.session.commit()
    return jsonify({'id': cert.id, 'ok': True})


@admin_bp.route('/api/certificates')
@admin_required
def api_certificates():
    certs = Certificate.query.all()
    result = []
    for c in certs:
        user = db.session.get(User, c.user_id)
        result.append({
            'id': c.id,
            'user': user.username if user else 'Unknown',
            'user_id': c.user_id,
            'category_title': c.category_title,
            'awarded_at': c.awarded_at.isoformat() if c.awarded_at else None,
        })
    return jsonify(result)


@admin_bp.route('/api/content-preview/<path:content_id>')
@admin_required
def api_content_preview(content_id):
    content = get_content_by_id(content_id)
    if not content:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({
        'id': content['id'],
        'title': content.get('title', ''),
        'type': content['type'],
        'body': content.get('body', ''),
        'path': content.get('path', ''),
    })


@admin_bp.route('/api/save-content', methods=['POST'])
@admin_required
def api_save_content():
    data = request.get_json()
    content_id = data.get('id')
    body = data.get('body')
    if not content_id or body is None:
        return jsonify({'error': 'Missing id or body'}), 400
    content = get_content_by_id(content_id)
    if not content:
        return jsonify({'error': 'Not found'}), 404
    filepath = os.path.join(current_app.config['COURSES_DIR'], content['path'])
    if not os.path.exists(filepath) or os.path.isdir(filepath):
        return jsonify({'error': 'File not found on disk'}), 404
    meta, _ = parse_front_matter(filepath)
    yaml_str = yaml.dump(meta, default_flow_style=False).strip()
    with open(filepath, 'w') as f:
        f.write(f'---\n{yaml_str}\n---\n\n{body}')
    return jsonify({'ok': True})


@admin_bp.route('/api/badges', methods=['GET', 'POST'])
@admin_required
def api_badges():
    if request.method == 'POST':
        data = request.get_json()
        badge = Badge(
            name=data.get('name', 'Untitled'),
            description=data.get('description', ''),
            icon=data.get('icon', 'award'),
            badge_type=data.get('badge_type', 'events'),
            config=json.dumps(data.get('config', {})),
            enabled=data.get('enabled', True),
        )
        db.session.add(badge)
        db.session.commit()
        return jsonify({'id': badge.id, 'ok': True})

    badges = Badge.query.all()
    return jsonify([{
        'id': b.id,
        'name': b.name,
        'description': b.description,
        'icon': b.icon,
        'badge_type': b.badge_type,
        'config': json.loads(b.config) if isinstance(b.config, str) else b.config,
        'enabled': b.enabled,
        'created_at': b.created_at.isoformat() if b.created_at else None,
    } for b in badges])


@admin_bp.route('/api/badges/<int:badge_id>', methods=['PUT'])
@admin_required
def api_update_badge(badge_id):
    badge = db.session.get(Badge, badge_id)
    if not badge:
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json()
    for field in ('name', 'description', 'icon', 'badge_type', 'enabled'):
        if field in data:
            setattr(badge, field, data[field])
    if 'config' in data:
        badge.config = json.dumps(data['config'])
    db.session.commit()
    return jsonify({'ok': True})


@admin_bp.route('/api/badges/<int:badge_id>/toggle', methods=['POST'])
@admin_required
def api_toggle_badge(badge_id):
    badge = db.session.get(Badge, badge_id)
    if not badge:
        return jsonify({'error': 'Not found'}), 404
    badge.enabled = not badge.enabled
    db.session.commit()
    return jsonify({'enabled': badge.enabled})


@admin_bp.route('/api/badges/award', methods=['POST'])
@admin_required
def api_award_badge():
    data = request.get_json()
    user_id = data.get('user_id')
    badge_id = data.get('badge_id')
    if not user_id or not badge_id:
        return jsonify({'error': 'Missing user_id or badge_id'}), 400
    existing = UserBadge.query.filter_by(user_id=user_id, badge_id=badge_id).first()
    if existing:
        return jsonify({'error': 'Already awarded'}), 409
    ub = UserBadge(user_id=user_id, badge_id=badge_id)
    db.session.add(ub)
    db.session.commit()
    return jsonify({'id': ub.id, 'ok': True})


# ---- Activity / Contribution Graph ----

import uuid

@admin_bp.route('/api/upload', methods=['POST'])
@admin_required
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    f = request.files['file']
    if f.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    ext = f.filename.rsplit('.', 1)[-1].lower() if '.' in f.filename else 'png'
    if ext not in ('png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'):
        return jsonify({'error': 'Unsupported format'}), 400
    filename = str(uuid.uuid4()) + '.' + ext
    upload_dir = os.path.join(current_app.root_path, '..', 'upload')
    os.makedirs(upload_dir, exist_ok=True)
    f.save(os.path.join(upload_dir, filename))
    return jsonify({'url': '/upload/' + filename})

@admin_bp.route('/api/course-tree')
@admin_required
def api_course_tree():
    return jsonify(get_course_tree(sorted=False))


@admin_bp.route('/api/activity/<int:user_id>')
@admin_required
def api_user_activity(user_id):
    from datetime import date, timedelta
    today = date.today()
    start = today - timedelta(days=365)
    logs = ActivityLog.query.filter(
        ActivityLog.user_id == user_id,
        ActivityLog.date >= start,
    ).all()
    result = {}
    for log in logs:
        result[log.date.isoformat()] = log.count
    return jsonify(result)


_SPA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'static', 'spa')


@admin_bp.route('/')
@admin_bp.route('/<path:path>')
def admin_spa_fallback(path=''):
    if path.startswith('api/'):
        return jsonify({'error': 'Not found'}), 404
    spa_index = os.path.join(_SPA_DIR, 'index.html')
    if os.path.isfile(spa_index):
        return send_file(spa_index)
    return jsonify({'error': 'Not found'}), 404
