from flask import Blueprint, render_template, jsonify, flash, redirect, url_for
from flask_login import current_user
from ..services.course_parser import (
    get_course_tree, get_content_by_id, check_item_locked,
    check_prerequisites, get_breadcrumb,
)
from ..services.assessment_parser import parse_content, get_assessment_mode
from ..models.progress import Progress

courses_bp = Blueprint('courses', __name__, url_prefix='/courses')


def _compute_locked(tree, completed_ids):
    locked = set()
    def walk(entries):
        for e in entries:
            cid = e.get('id')
            preq = e.get('prerequisites', [])
            config = e.get('config', {})
            if preq and not all(pid in completed_ids for pid in preq):
                locked.add(cid)
            if check_item_locked(config):
                locked.add(cid)
            if 'children' in e:
                walk(e['children'])
    walk(tree)
    return locked


@courses_bp.route('/')
def tree():
    course_tree = get_course_tree()
    completed_ids = []
    if current_user.is_authenticated:
        completed = Progress.query.filter_by(
            user_id=current_user.id, completed=True
        ).all()
        completed_ids = [p.content_id for p in completed]
    locked_ids = _compute_locked(course_tree, completed_ids)
    return render_template('pages/courses.html', tree=course_tree, completed_ids=completed_ids, locked_ids=locked_ids)


@courses_bp.route('/<path:content_id>')
def view(content_id):
    content = get_content_by_id(content_id)
    if not content:
        return render_template('pages/404.html'), 404

    config = content.get('config', {})
    if check_item_locked(config):
        flash('This content is locked and not yet available.', 'error')
        return redirect(url_for('courses.tree'))

    if current_user.is_authenticated:
        completed = Progress.query.filter_by(
            user_id=current_user.id, completed=True
        ).all()
        completed_ids = [p.content_id for p in completed]
        prereqs = content.get('prerequisites', [])
        if prereqs and not all(pid in completed_ids for pid in prereqs):
            flash('Complete the prerequisites first.', 'error')
            return redirect(url_for('courses.tree'))

    assessments = parse_content(content.get('type', 'note'), content.get('body', ''))
    breadcrumb = get_breadcrumb(content_id)
    return render_template('pages/content_viewer.html', content=content, assessments=assessments, breadcrumb=breadcrumb)


@courses_bp.route('/api/tree')
def api_tree():
    course_tree = get_course_tree()
    return jsonify(course_tree)
