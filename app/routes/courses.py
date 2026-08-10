import os
from flask import Blueprint, render_template, jsonify, flash, redirect, url_for, send_file, current_app
from flask_login import current_user
from ..services.course_parser import (
    get_course_tree, get_content_by_id, check_item_locked,
    check_prerequisites, get_breadcrumb, get_pdf_url,
    get_sort_key, _render_markdown, _get_course_overview, _get_course_references,
)
from ..services.assessment_parser import parse_content, get_assessment_mode
from ..models.progress import Progress

courses_bp = Blueprint('courses', __name__, url_prefix='/courses')


def _get_first_unlocked_in_children(entries, completed_ids):
    """Find the first non-category item in the first child that should be unlocked."""
    for entry in entries:
        if entry.get('type') == 'category' and 'children' in entry:
            children = entry['children']
            if children:
                first = children[0]
                if first.get('type') != 'category':
                    return first.get('id')
                else:
                    return _get_first_unlocked_in_children([first], completed_ids)
    return None


def _compute_locked(tree, completed_ids):
    """Compute locked items based solely on admin-configured lock settings.
    
    Only items with lock_type set are locked (along with all descendants).
    Prerequisites are also enforced.
    No automatic progressive/sequential unlock.
    """
    locked = set()

    def walk(entries):
        for e in entries:
            cid = e.get('id')
            config = e.get('config', {})

            # Admin-configured locks (date, manual, pass)
            if check_item_locked(config):
                locked.add(cid)
                def lock_all(entries):
                    for ch in entries:
                        locked.add(ch.get('id'))
                        if 'children' in ch:
                            lock_all(ch['children'])
                if 'children' in e:
                    lock_all(e['children'])
                continue

            # Prerequisite check
            preq = e.get('prerequisites', [])
            if preq and not all(pid in completed_ids for pid in preq):
                locked.add(cid)
                continue

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
    locked_ids = list(_compute_locked(course_tree, completed_ids))
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

    assessments = parse_content(content.get('type', 'lecture'), content.get('body', ''))
    breadcrumb = get_breadcrumb(content_id)
    content['rendered_body'] = _render_markdown(content.get('body', ''))
    return render_template('pages/content_viewer.html', content=content, assessments=assessments, breadcrumb=breadcrumb)


@courses_bp.route('/api/tree')
def api_tree():
    course_tree = get_course_tree()
    return jsonify(course_tree)


@courses_bp.route('/<path:content_id>/curriculum')
def curriculum(content_id):
    """Return full accordion tree for a course/category."""
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
    locked_ids = list(_compute_locked(course_tree, completed_ids))

    # Count lessons recursively
    def count_lessons(entries):
        total = 0
        for e in entries:
            if e.get('type') != 'category':
                total += 1
            elif 'children' in e:
                total += count_lessons(e['children'])
        return total

    def count_completed(entries, completed_ids):
        total = 0
        for e in entries:
            if e.get('type') != 'category' and e.get('id') in completed_ids:
                total += 1
            elif 'children' in e:
                total += count_completed(e['children'], completed_ids)
        return total

    def build_node(entry, depth=0):
        node = {
            'id': entry.get('id'),
            'name': entry.get('title') or entry.get('name', 'Untitled'),
            'type': entry.get('type'),
            'depth': depth,
            'locked': entry.get('id') in locked_ids,
            'completed': entry.get('id') in completed_ids,
        }
        if entry.get('type') == 'category':
            children = entry.get('children', [])
            node['total'] = count_lessons(children)
            node['completed_count'] = count_completed(children, completed_ids)
            node['children'] = [build_node(c, depth + 1) for c in children]
        else:
            node['content_type'] = entry.get('type')
        return node

    result = build_node(content)
    return jsonify(result)


@courses_bp.route('/<path:content_id>/detail')
def detail(content_id):
    """Return course metadata for hero card."""
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
    locked_ids = list(_compute_locked(course_tree, completed_ids))

    def count_lessons(entries):
        total = 0
        for e in entries:
            if e.get('type') != 'category':
                total += 1
            elif 'children' in e:
                total += count_lessons(e['children'])
        return total

    def count_completed(entries):
        total = 0
        for e in entries:
            if e.get('type') != 'category' and e.get('id') in completed_ids:
                total += 1
            elif 'children' in e:
                total += count_completed(e['children'])
        return total

    total = count_lessons(content.get('children', []))
    completed_count = count_completed(content.get('children', []))
    progress_pct = round((completed_count / total * 100) if total > 0 else 0)

    # Count sections (subcategories)
    section_count = 0
    for child in content.get('children', []):
        if child.get('type') == 'category':
            section_count += 1

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


@courses_bp.route('/<path:content_id>/overview')
def overview(content_id):
    """Return rendered OVERVIEW.md content."""
    content = get_content_by_id(content_id)
    if not content or content.get('type') != 'category':
        return jsonify({'html': ''})
    cat_path = content.get('path', '')
    if cat_path:
        cat_path = os.path.dirname(cat_path)
    html = _get_course_overview(cat_path)
    return jsonify({'html': html})


@courses_bp.route('/<path:content_id>/references')
def references(content_id):
    """Return list of reference files from REFERENCE/ folder."""
    content = get_content_by_id(content_id)
    if not content or content.get('type') != 'category':
        return jsonify({'references': []})
    cat_path = content.get('path', '')
    if cat_path:
        cat_path = os.path.dirname(cat_path)
    refs = _get_course_references(cat_path)
    return jsonify({'references': refs})


@courses_bp.route('/file/<path:content_id>')
def serve_file(content_id):
    rel_path = get_pdf_url(content_id)
    if not rel_path:
        return 'Not found', 404
    courses_dir = current_app.config['COURSES_DIR']
    filepath = os.path.join(courses_dir, rel_path)
    if not os.path.isfile(filepath):
        return 'Not found', 404
    return send_file(filepath, mimetype='application/pdf')
