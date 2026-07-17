import os
import re
import time
from datetime import datetime, timedelta
import yaml
from flask import current_app
from .assessment_parser import normalize_type

FRONT_MATTER_RE = re.compile(r'^---\s*\n(.*?)\n---\s*\n(.*)', re.DOTALL)

STRUCTURE_FILE = 'course_structure.yaml'
METADATA_FILE = 'course_metadata.yaml'
SIGNAL_FILE = '.structure_updated'

_cache = {'tree': None, 'yaml_mtime': 0.0}


def parse_front_matter(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except (UnicodeDecodeError, OSError):
        return {}, ''
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


# ---------- YAML tree cache (written by monitor_structure.py) ----------

def _tree_path():
    return os.path.join(current_app.config['COURSES_DIR'], STRUCTURE_FILE)


def _signal_path():
    return os.path.join(current_app.config['COURSES_DIR'], SIGNAL_FILE)


def _metadata_path():
    return os.path.join(current_app.config['COURSES_DIR'], METADATA_FILE)


def _read_yaml(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path, 'r') as f:
            return yaml.safe_load(f) or {}
    except (yaml.YAMLError, OSError):
        return {}


def _write_yaml(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True)


def _signal_mtime():
    sp = _signal_path()
    if os.path.exists(sp):
        try:
            return os.path.getmtime(sp)
        except OSError:
            return 0.0
    return 0.0


# ---------- metadata overlay (admin-managed locks, prerequisites, etc.) ----------

def load_structure():
    return _read_yaml(_metadata_path())


def save_structure(data):
    _write_yaml(_metadata_path(), data)


# ---------- tree cache ----------

def load_tree_cache():
    global _cache
    tree = _read_yaml(_tree_path())
    if isinstance(tree, list):
        _cache['tree'] = tree
    else:
        _cache['tree'] = []
    _cache['yaml_mtime'] = _signal_mtime()
    return _cache['tree']


def invalidate_cache():
    global _cache
    _cache = {'tree': None, 'yaml_mtime': 0.0}


def _ensure_cache():
    global _cache
    sig_mtime = _signal_mtime()
    if _cache['tree'] is None or sig_mtime != _cache['yaml_mtime']:
        load_tree_cache()
    return _cache['tree']


def _merge_metadata(entries, metadata):
    if not metadata:
        return entries
    for entry in entries:
        cid = entry.get('id', '')
        config = metadata.get(cid, {})
        if config:
            if 'title' in config:
                entry['title'] = config['title']
            if 'hidden' in config:
                entry['hidden'] = config['hidden']
            if 'image' in config:
                entry['image'] = config['image']
            if 'description' in config:
                entry['description'] = config['description']
            if 'prerequisites' in config:
                entry['prerequisites'] = config['prerequisites']
            if 'lock_type' in config:
                entry['lock_type'] = config['lock_type']
            if 'lock_value' in config:
                entry['lock_value'] = config['lock_value']
            entry['config'] = config
        else:
            entry['config'] = config
        if 'children' in entry:
            _merge_metadata(entry['children'], metadata)
            if entry.get('hidden'):
                entry['children'] = [c for c in entry['children'] if not c.get('hidden')]


def get_course_tree():
    tree = _ensure_cache()
    if not tree:
        return []
    import copy
    merged = copy.deepcopy(tree)
    metadata = load_structure()
    _merge_metadata(merged, metadata)
    merged = [e for e in merged if not e.get('hidden')]
    _mark_category_types(merged)
    return merged


def _mark_category_types(entries, depth=0):
    for entry in entries:
        if entry.get('type') != 'category':
            continue
        children = entry.get('children', [])
        subcats = [c for c in children if c.get('type') == 'category']
        if depth == 0:
            entry['category_type'] = 'parent'
        elif subcats:
            entry['category_type'] = 'category'
        else:
            entry['category_type'] = 'subcategory'
        if children:
            _mark_category_types(children, depth + 1)


def get_breadcrumb(content_id):
    tree = _ensure_cache()

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


def _load_body_for_entry(entry):
    if entry.get('type') == 'category' or not entry.get('path', '').endswith('.md'):
        return entry
    courses_dir = current_app.config['COURSES_DIR']
    filepath = os.path.join(courses_dir, entry['path'])
    if os.path.exists(filepath):
        meta, body = parse_front_matter(filepath)
        entry['body'] = body
        entry['meta'] = meta
        if 'min_errors' in meta:
            entry['min_errors'] = meta['min_errors']
    return entry


def get_content_by_id(content_id):
    tree = _ensure_cache()

    def search(entries):
        for entry in entries:
            if entry.get('id') == content_id:
                return entry
            if 'children' in entry:
                result = search(entry['children'])
                if result:
                    return result
        return None

    result = search(tree)
    if result:
        result = dict(result)
        _load_body_for_entry(result)
        metadata = load_structure()
        cid = result.get('id', '')
        config = metadata.get(cid, {})
        result['config'] = config
        result.setdefault('prerequisites', config.get('prerequisites', []))
        result.setdefault('lock_type', config.get('lock_type'))
        result.setdefault('lock_value', config.get('lock_value'))
    return result


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
    tree = _ensure_cache()
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
    from monitor_structure import scan_courses, save_tree as _save_tree
    courses_dir = current_app.config['COURSES_DIR']
    tree = scan_courses(courses_dir)
    _save_tree(tree, courses_dir)
    invalidate_cache()
    return build_structure_index()


def get_all_content_ids():
    tree = _ensure_cache()
    ids = set()

    def walk(entries):
        for e in entries:
            if e.get('type') not in ('category',):
                ids.add(e['id'])
            if 'children' in e:
                walk(e['children'])

    walk(tree)
    return ids
