import json
import os
from datetime import datetime, timedelta
import yaml
from flask import Blueprint, render_template, redirect, url_for, flash, request, jsonify, current_app
from flask_login import login_required, current_user
from .. import db
from ..models.user import User
from ..models.progress import Progress
from ..models.admin import Ban, Certificate, CertificateTemplate
from ..models.badge import Badge, UserBadge, ActivityLog
from ..services.course_parser import (
    get_course_tree, get_content_by_id, capture_structure,
    load_structure, save_structure, build_structure_index,
    parse_front_matter,
)

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')


def admin_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_authenticated or current_user.role not in ('admin', 'instructor'):
            flash('Admin access required', 'error')
            return redirect(url_for('main.index'))
        return f(*args, **kwargs)
    return decorated


@admin_bp.route('/')
@login_required
@admin_required
def dashboard():
    total_users = User.query.count()
    total_progress = Progress.query.count()
    completed = Progress.query.filter_by(completed=True).count()
    structure = load_structure()
    return render_template('pages/admin_dashboard.html',
                           total_users=total_users,
                           total_progress=total_progress,
                           completed=completed,
                           content_count=len(structure))


@admin_bp.route('/content')
@login_required
@admin_required
def content_tree():
    structure = load_structure()
    return render_template('pages/admin_content.html', tree=get_course_tree(), structure=structure)


@admin_bp.route('/api/structure', methods=['GET', 'POST'])
@login_required
@admin_required
def api_structure():
    if request.method == 'POST':
        data = request.get_json()
        if data:
            save_structure(data)
            return jsonify({'ok': True})
    return jsonify(load_structure())


@admin_bp.route('/api/capture', methods=['POST'])
@login_required
@admin_required
def api_capture():
    structure = capture_structure()
    return jsonify(structure)


@admin_bp.route('/api/update-item', methods=['POST'])
@login_required
@admin_required
def api_update_item():
    data = request.get_json()
    item_id = data.get('id')
    updates = data.get('updates', {})
    structure = load_structure()
    if item_id in structure:
        structure[item_id].update(updates)
        save_structure(structure)
        return jsonify({'ok': True})
    return jsonify({'error': 'Not found'}), 404


@admin_bp.route('/api/batch-update', methods=['POST'])
@login_required
@admin_required
def api_batch_update():
    data = request.get_json()
    ids = data.get('ids', [])
    updates = data.get('updates', {})
    structure = load_structure()
    for item_id in ids:
        if item_id in structure:
            structure[item_id].update(updates)
    save_structure(structure)
    return jsonify({'ok': True})


@admin_bp.route('/users')
@login_required
@admin_required
def user_list():
    users = User.query.all()
    return render_template('pages/admin_users.html', users=users)


@admin_bp.route('/api/users')
@login_required
@admin_required
def api_users():
    users = User.query.all()
    result = []
    for u in users:
        completed = Progress.query.filter_by(user_id=u.id, completed=True).count()
        result.append({
            'id': u.id,
            'email': u.email,
            'username': u.username,
            'role': u.role,
            'banned': u.is_banned,
            'completed': completed,
        })
    return jsonify(result)


@admin_bp.route('/api/users/<int:user_id>/ban', methods=['POST'])
@login_required
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
@login_required
@admin_required
def api_unban_user(user_id):
    bans = Ban.query.filter_by(user_id=user_id, active=True).all()
    for b in bans:
        b.active = False
    db.session.commit()
    return jsonify({'ok': True})


@admin_bp.route('/submissions')
@login_required
@admin_required
def submissions():
    projects = Progress.query.filter_by(content_type='project').filter(
        Progress.submission.isnot(None)
    ).all()
    return render_template('pages/admin_submissions.html', projects=projects)


@admin_bp.route('/api/submissions')
@login_required
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
@login_required
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


@admin_bp.route('/certificates')
@login_required
@admin_required
def certificates():
    templates = CertificateTemplate.query.all()
    tree_index = build_structure_index()
    return render_template('pages/admin_certificates.html',
                           templates=templates,
                           tree_index=tree_index)


@admin_bp.route('/api/certificate-templates', methods=['GET', 'POST'])
@login_required
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
@login_required
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
@login_required
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
@login_required
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
@login_required
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
@login_required
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


# ---- Badge Management ----

@admin_bp.route('/badges')
@login_required
@admin_required
def badge_list():
    badges = Badge.query.all()
    return render_template('pages/admin_badges.html', badges=badges)


@admin_bp.route('/api/badges', methods=['GET', 'POST'])
@login_required
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
@login_required
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
@login_required
@admin_required
def api_toggle_badge(badge_id):
    badge = db.session.get(Badge, badge_id)
    if not badge:
        return jsonify({'error': 'Not found'}), 404
    badge.enabled = not badge.enabled
    db.session.commit()
    return jsonify({'enabled': badge.enabled})


@admin_bp.route('/api/badges/award', methods=['POST'])
@login_required
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
@login_required
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

@admin_bp.route('/api/activity/<int:user_id>')
@login_required
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
