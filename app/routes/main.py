import os
from flask import Blueprint, render_template, redirect, url_for, request, flash, send_from_directory, current_app
from flask_login import login_required, current_user
from .. import db
from ..models.progress import Progress
from ..models.admin import Certificate

main_bp = Blueprint('main', __name__)


@main_bp.route('/')
def index():
    if current_user.is_authenticated:
        if current_user.role in ('admin', 'instructor'):
            return redirect(url_for('admin.dashboard'))
        return redirect(url_for('main.dashboard'))
    return render_template('pages/landing.html')


@main_bp.route('/dashboard')
@login_required
def dashboard():
    completed = Progress.query.filter_by(
        user_id=current_user.id, completed=True
    ).all()
    return render_template('pages/user_dashboard.html', completed=completed)


@main_bp.route('/profile')
@login_required
def profile():
    certificates = Certificate.query.filter_by(user_id=current_user.id).all()
    completed = Progress.query.filter_by(
        user_id=current_user.id, completed=True
    ).count()
    return render_template('pages/profile.html', certificates=certificates, completed=completed)


@main_bp.route('/upload/<path:filename>')
def uploaded_file(filename):
    upload_dir = os.path.join(current_app.root_path, '..', 'upload')
    return send_from_directory(upload_dir, filename)


@main_bp.route('/settings', methods=['GET', 'POST'])
@login_required
def settings():
    if request.method == 'POST':
        visibility = request.form.get('visibility', 'public')
        current_user.profile_visibility = visibility
        db.session.commit()
        flash('Settings updated', 'success')
        return redirect(url_for('main.settings'))
    return render_template('pages/settings.html')
