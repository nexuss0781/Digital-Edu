from flask import Blueprint, render_template, redirect, url_for, flash, request
from flask_login import login_user, logout_user, login_required, current_user
from werkzeug.security import check_password_hash
from .. import db
from ..models.user import User

auth_bp = Blueprint('auth', __name__, url_prefix='/auth')

@auth_bp.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))

    if request.method == 'POST':
        email = request.form.get('email')
        username = request.form.get('username')
        password = request.form.get('password')
        role = request.form.get('role', 'student')

        if User.query.filter_by(email=email).first():
            flash('Email already registered', 'error')
            return render_template('pages/register.html')

        if User.query.filter_by(username=username).first():
            flash('Username already taken', 'error')
            return render_template('pages/register.html')

        if role == 'admin':
            role = 'instructor'
        user = User(email=email, username=username, role=role)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()

        login_user(user)
        flash('Registration successful! Welcome to DigitalEdu.', 'success')
        return redirect(url_for('main.dashboard'))

    return render_template('pages/register.html')


@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))

    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        user = User.query.filter_by(email=email).first()

        if user and user.check_password(password):
            login_user(user)
            next_page = request.args.get('next')
            return redirect(next_page or url_for('main.index'))

        flash('Invalid email or password', 'error')

    return render_template('pages/login.html')


@auth_bp.route('/change-password', methods=['POST'])
@login_required
def change_password():
    current_pw = request.form.get('current_password')
    new_pw = request.form.get('new_password')
    confirm_pw = request.form.get('confirm_password')

    if not current_user.check_password(current_pw):
        flash('Current password is incorrect', 'error')
        return redirect(url_for('main.settings'))

    if new_pw != confirm_pw:
        flash('New passwords do not match', 'error')
        return redirect(url_for('main.settings'))

    if len(new_pw) < 6:
        flash('Password must be at least 6 characters', 'error')
        return redirect(url_for('main.settings'))

    current_user.set_password(new_pw)
    db.session.commit()
    flash('Password changed successfully', 'success')
    return redirect(url_for('main.settings'))


@auth_bp.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('main.index'))
