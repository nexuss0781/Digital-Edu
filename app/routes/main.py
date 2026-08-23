import os
from flask import Blueprint, redirect, url_for, request, flash, send_from_directory, current_app
from flask_login import login_required
from .. import db
from .spa import serve_spa

main_bp = Blueprint('main', __name__)


@main_bp.route('/')
def index():
    return serve_spa()


@main_bp.route('/dashboard')
@login_required
def dashboard():
    return serve_spa()


@main_bp.route('/profile')
@login_required
def profile():
    return serve_spa()


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
    return serve_spa()
