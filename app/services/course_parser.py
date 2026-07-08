import os
import re
import fnmatch
from datetime import datetime, timedelta
import yaml
from flask import current_app
from .assessment_parser import normalize_type

FRONT_MATTER_RE = re.compile(r'^---\s*\n(.*?)\n---\s*\n(.*)', re.DOTALL)

STRUCTURE_FILE = 'course_structure.yaml'
COURSEIGNORE_FILE = '.courseignore'


# ---------- .courseignore support ----------

def load_courseignore(base_path):
    path = os.path.join(base_path, COURSEIGNORE_FILE)
    if not os.path.exists(path):
        return []
    patterns = []
    with open(path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            patterns.append(line)
    return patterns


def is_ignored(rel_path, base_path, ignore_patterns):
    if not ignore_patterns:
        return False

    norm = rel_path.replace('\\', '/')

    for pattern in ignore_patterns:
        norm_pattern = pattern.rstrip('/')

        # Exact match (file or dir)
        if fnmatch.fnmatch(norm, norm_pattern):
            return True

        # Pattern is a directory (ends with / originally)
        if pattern.endswith('/'):
            # Check if path starts with this directory
            if norm == norm_pattern or norm.startswith(norm_pattern + '/'):
                return True
            # Check if any component matches
            parts = norm.split('/')
            for part in parts:
                if fnmatch.fnmatch(part, norm_pattern):
                    return True

        # Pattern is a glob — match against each component
        parts = norm.split('/')
        for part in parts:
            if fnmatch.fnmatch(part, pattern):
                return True

    return False

def parse_front_matter(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    match = FRONT_MATTER_RE.match(content)
    if not match:
        return {'type': 'note'}, content

    try:
        meta = yaml.safe_load(match.group(1))
    except yaml.YAMLError:
        meta = {}

    if meta is None:
        meta = {}

    return meta, match.group(2)


def get_sort_key(name):
    match = re.match(r'^(\d+(?:\.\d+)*)', name)
    if match:
        parts = match.group(1).split('.')
        return tuple(int(p) for p in parts)
    return (float('inf'),)


def path_to_id(rel_path):
    parts = rel_path.replace('\\', '/').split('/')
    cleaned = []
    for p in parts:
        p = re.sub(r'^[\d.\s]+', '', p)
        p = re.sub(r'\s+', '-', p.strip())
        p = p.lower().replace('.md', '')
        if p:
            cleaned.append(p)
    return '/'.join(cleaned) if cleaned else 'root'


def name_to_title(name):
    name = name.replace('.md', '')
    name = re.sub(r'^[\d.\s]+', '', name).strip()
    return name


def load_structure():
    courses_dir = current_app.config['COURSES_DIR']
    struct_path = os.path.join(courses_dir, STRUCTURE_FILE)
    if os.path.exists(struct_path):
        with open(struct_path, 'r') as f:
            return yaml.safe_load(f) or {}
    return {}


def save_structure(data):
    courses_dir = current_app.config['COURSES_DIR']
    os.makedirs(courses_dir, exist_ok=True)
    struct_path = os.path.join(courses_dir, STRUCTURE_FILE)
    with open(struct_path, 'w') as f:
        yaml.dump(data, f, default_flow_style=False)


def scan_directory(base_path, rel_path='', depth=0):
    entries = []
    full_path = os.path.join(base_path, rel_path)

    if not os.path.exists(full_path):
        return entries

    ignore_patterns = load_courseignore(base_path)
    names = sorted(os.listdir(full_path), key=get_sort_key)
    structure = load_structure()

    for name in names:
        entry_path = os.path.join(rel_path, name)
        full_entry_path = os.path.join(base_path, entry_path)

        # Skip entries matching .courseignore patterns
        rel_for_ignore = name if depth == 0 else entry_path.replace('\\', '/')
        if is_ignored(rel_for_ignore, base_path, ignore_patterns):
            continue

        content_id = path_to_id(entry_path)
        title = name_to_title(name)
        config = structure.get(content_id, {})

        if os.path.isdir(full_entry_path):
            children = scan_directory(base_path, entry_path, depth + 1)
            hidden = config.get('hidden', False)
            if hidden and not children:
                continue
            entries.append({
                'name': name,
                'path': entry_path,
                'type': 'category',
                'id': content_id,
                'title': config.get('title', title),
                'sort_key': get_sort_key(name),
                'children': children,
                'config': config,
                'depth': depth,
                'hidden': hidden,
            })
        elif name.endswith('.md'):
            meta, body = parse_front_matter(full_entry_path)
            ctype = normalize_type(meta.get('type', 'note'))
            hidden = config.get('hidden', False)
            if hidden:
                continue
            entries.append({
                'name': name,
                'path': entry_path,
                'type': ctype,
                'id': config.get('id', meta.get('id', content_id)),
                'title': config.get('title', meta.get('title', title)),
                'sort_key': get_sort_key(name),
                'body': body,
                'meta': meta,
                'config': config,
                'prerequisites': config.get('prerequisites', []),
                'min_errors': meta.get('min_errors'),
                'lock_type': config.get('lock_type'),
                'lock_value': config.get('lock_value'),
                'hidden': hidden,
                'depth': depth,
            })

    entries.sort(key=lambda e: e['sort_key'])
    return entries


def get_course_tree():
    courses_dir = current_app.config['COURSES_DIR']
    return scan_directory(courses_dir)


def get_breadcrumb(content_id):
    tree = get_course_tree()
    def walk(entries, path):
        for e in entries:
            current_path = path + [{'id': e.get('id'), 'name': e.get('name'), 'title': e.get('title') or e.get('name')}]
            if e.get('id') == content_id:
                return current_path
            if 'children' in e:
                result = walk(e['children'], current_path)
                if result:
                    return result
        return None
    result = walk(tree, [])
    return result[:-1] if result else []


def get_content_by_id(content_id):
    def search(entries):
        for entry in entries:
            if entry.get('id') == content_id:
                return entry
            if 'children' in entry:
                result = search(entry['children'])
                if result:
                    return result
        return None

    tree = get_course_tree()
    return search(tree)


def check_prerequisites(content_id, completed_ids):
    content = get_content_by_id(content_id)
    if not content:
        return True
    prereqs = content.get('prerequisites', [])
    if not prereqs:
        return True
    return all(pid in completed_ids for pid in prereqs)


def parse_lock_value(lock_value):
    if not lock_value:
        return None
    lock_value = lock_value.strip()
    date_match = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{2,4})$', lock_value)
    if date_match:
        day, month, year = int(date_match.group(1)), int(date_match.group(2)), int(date_match.group(3))
        if year < 100:
            year += 2000
        try:
            return datetime(year, month, day)
        except ValueError:
            return None
    num_match = re.match(r'^(\d+)\s+(day|days|week|weeks|month|months|year|years)$', lock_value)
    if num_match:
        num = int(num_match.group(1))
        unit = num_match.group(2)
        kwargs = {}
        if unit.startswith('day'):
            kwargs['days'] = num
        elif unit.startswith('week'):
            kwargs['weeks'] = num
        elif unit.startswith('month'):
            kwargs['days'] = num * 30
        elif unit.startswith('year'):
            kwargs['days'] = num * 365
        return datetime.utcnow() + timedelta(**kwargs)
    return None


def check_item_locked(config):
    if not config:
        return False
    lock_type = config.get('lock_type')
    if not lock_type:
        return False
    if lock_type == 'date':
        lock_value = config.get('lock_value')
        unlock_date = parse_lock_value(lock_value)
        if unlock_date and datetime.utcnow() < unlock_date:
            return True
        return False
    if lock_type in ('pass', 'manual'):
        return True
    return False


def build_structure_index():
    tree = get_course_tree()
    index = {}

    def walk(entries, parent_id=''):
        for e in entries:
            cid = e['id']
            index[cid] = {
                'id': cid,
                'title': e.get('title', e['name']),
                'type': e['type'],
                'path': e['path'],
                'parent_id': parent_id or None,
            }
            if 'children' in e:
                walk(e['children'], cid)

    walk(tree)
    return index


def capture_structure():
    index = build_structure_index()
    structure = {}
    for cid, info in index.items():
        structure[cid] = {
            'title': info['title'],
            'type': info['type'],
            'path': info['path'],
            'parent_id': info['parent_id'],
            'prerequisites': [],
            'hidden': False,
            'lock_type': None,
            'lock_value': None,
        }
    save_structure(structure)
    return structure
