import os
import re
import json
import time
import markdown
from datetime import datetime, timedelta
import yaml
from flask import current_app
from .assessment_parser import normalize_type, parse_content

MD_EXTENSIONS = [
    'tables', 'fenced_code', 'codehilite', 'toc',
    'attr_list', 'md_in_html', 'sane_lists', 'smarty',
]


def _render_markdown(text):
    if not text:
        return ''
    return markdown.markdown(
        text,
        extensions=MD_EXTENSIONS,
        extension_configs={
            'codehilite': {'css_class': 'highlight', 'linenums': False},
            'toc': {'permalink': False},
        },
    )


def _get_course_overview(category_path):
    courses_dir = current_app.config['COURSES_DIR']
    overview_path = os.path.join(courses_dir, category_path, 'OVERVIEW.md')
    if os.path.isfile(overview_path):
        try:
            with open(overview_path, 'r', encoding='utf-8') as f:
                content = f.read()
            return _render_markdown(content)
        except (UnicodeDecodeError, OSError):
            return ''
    return ''


def _get_course_references(category_path):
    courses_dir = current_app.config['COURSES_DIR']
    ref_dir = os.path.join(courses_dir, category_path, 'REFERENCE')
    references = []
    if not os.path.isdir(ref_dir):
        return references
    for fname in sorted(os.listdir(ref_dir)):
        fpath = os.path.join(ref_dir, fname)
        if os.path.isfile(fpath):
            ext = os.path.splitext(fname)[1].lower()
            ref = {'name': fname, 'ext': ext}
            if ext in ('.md', '.txt'):
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        content = f.read()
                    ref['content'] = _render_markdown(content) if ext == '.md' else content
                    ref['type'] = 'text'
                except (UnicodeDecodeError, OSError):
                    ref['content'] = ''
                    ref['type'] = 'text'
            elif ext == '.pdf':
                ref['type'] = 'pdf'
                ref['url'] = f'/courses/file/{category_path}/REFERENCE/{fname}'
            elif ext in ('.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'):
                ref['type'] = 'image'
                ref['url'] = f'/upload/{fname}'
            else:
                ref['type'] = 'file'
            references.append(ref)
    return references

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
        return {'type': 'lecture'}, content
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


# ---------- workshop group loading (written by C++ workshop_grouper) ----------

_WORKSHOP_GROUPS = None


def _load_workshop_groups():
    global _WORKSHOP_GROUPS
    if _WORKSHOP_GROUPS is not None:
        return _WORKSHOP_GROUPS
    groups_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                               'scripts', 'workshop_groups.json')
    if not os.path.exists(groups_path):
        _WORKSHOP_GROUPS = []
        return _WORKSHOP_GROUPS
    try:
        with open(groups_path, 'r') as f:
            data = json.load(f)
        _WORKSHOP_GROUPS = data.get('workshop_groups', [])
    except (json.JSONDecodeError, OSError):
        _WORKSHOP_GROUPS = []
    return _WORKSHOP_GROUPS


def invalidate_workshop_groups():
    global _WORKSHOP_GROUPS
    _WORKSHOP_GROUPS = None


def _extract_fcc_section(body, marker):
    pattern = rf'^# --{re.escape(marker)}--\s*\n(.*?)(?=^# --|\Z)'
    match = re.search(pattern, body, re.MULTILINE | re.DOTALL)
    if match:
        return match.group(1).strip()
    return ''


def _extract_hints(section):
    hints = []
    if not section:
        return hints
    parts = re.split(r'```(?:js)?\s*\n(.*?)```', section, flags=re.DOTALL)
    for i in range(0, len(parts) - 1, 2):
        text = parts[i].strip()
        code = parts[i + 1].strip()
        if not text and not code:
            continue
        hints.append({'text': text, 'code': code})
    if len(parts) % 2 == 1 and parts[-1].strip() and hints:
        hints[-1]['text'] = (hints[-1]['text'] + '\n' + parts[-1].strip()).strip()
    return hints


def _extract_seed_files(seed_section):
    seed_files = []
    if not seed_section:
        return seed_files
    for m in re.finditer(r'```(\w+)\s*\n(.*?)```', seed_section, re.DOTALL):
        seed_files.append({'language': m.group(1), 'code': m.group(2).strip('\n')})
    return seed_files


def _step_number_from_file(courses_dir, sf):
    filepath = os.path.join(courses_dir, sf['path'])
    if not os.path.exists(filepath):
        return None
    meta, _ = parse_front_matter(filepath)
    dashed = meta.get('dashedName', '')
    m = re.match(r'^step-(\d+)$', dashed)
    if m:
        return int(m.group(1))
    title = meta.get('title', '')
    m = re.match(r'^Step (\d+)$', title)
    if m:
        return int(m.group(1))
    return None


def get_workshop_content(content_id):
    groups = _load_workshop_groups()
    group = None
    for g in groups:
        if g['parent_id'] == content_id:
            group = g
            break
    if not group:
        return None

    courses_dir = current_app.config['COURSES_DIR']

    ordered_steps = sorted(
        group['steps'],
        key=lambda sf: (_step_number_from_file(courses_dir, sf) is None,
                        _step_number_from_file(courses_dir, sf) or 0),
    )

    steps = []
    body_parts = []
    seed_code = ''

    for si, sf in enumerate(ordered_steps):
        filepath = os.path.join(courses_dir, sf['path'])
        if not os.path.exists(filepath):
            continue
        meta, body = parse_front_matter(filepath)

        desc = _extract_fcc_section(body, 'description')
        seed_section = _extract_fcc_section(body, 'seed')

        seed_match = re.search(r'```(\w+)\s*\n(.*?)```', seed_section, re.DOTALL) if seed_section else None
        step_seed = seed_match.group(2).strip() if seed_match else ''

        solution_section = _extract_fcc_section(body, 'solutions')
        sol_match = re.search(r'```(\w+)\s*\n(.*?)```', solution_section, re.DOTALL) if solution_section else None
        solution = sol_match.group(2).strip() if sol_match else ''

        hints_section = _extract_fcc_section(body, 'hints')
        hints = _extract_hints(hints_section)
        seed_files = _extract_seed_files(seed_section)

        if si == 0 and step_seed:
            seed_code = step_seed

        steps.append({
            'step': si + 1,
            'title': meta.get('title', f'Step {si + 1}'),
            'description': desc,
            'seed': step_seed,
            'seed_files': seed_files,
            'solution': solution,
            'hints': hints,
        })
        body_parts.append(desc or body or '')

    merged_body = '\n\n'.join(body_parts)

    result = {
        'id': group['parent_id'],
        'title': group['title'],
        'name': group['title'],
        'type': 'workshop',
        'path': group['directory_path'],
        'body': merged_body,
        'seed': seed_code,
        'step_count': group['step_count'],
        'steps': steps,
        'parent': True,
    }
    return result


# ---------- YAML tree cache (written by monitor_structure.py) ----------

def _tree_path():
    return os.path.join(current_app.config['COURSES_DIR'], STRUCTURE_FILE)


def _signal_path():
    return os.path.join(current_app.config['COURSES_DIR'], SIGNAL_FILE)


def _metadata_path():
    return os.path.join(current_app.config['COURSES_DIR'], METADATA_FILE)


def _metadata_mtime():
    mp = _metadata_path()
    if os.path.exists(mp):
        try:
            return os.path.getmtime(mp)
        except OSError:
            return -1.0
    return -1.0


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


def get_structure_version():
    """Stable version string for the course tree; changes whenever the
    course structure or admin metadata (hidden/locks/prereqs) change."""
    return f"{_signal_mtime():.3f}:{_metadata_mtime():.3f}"


# ---------- metadata overlay (admin-managed locks, prerequisites, etc.) ----------

def load_structure():
    """Load admin metadata YAML, cached until the file changes (ms-resolution)."""
    global _META_CACHE
    mtime = _metadata_mtime()
    if _META_CACHE['data'] is not None and _META_CACHE['mtime'] == mtime:
        return _META_CACHE['data']
    data = _load_yaml(_metadata_path())
    _META_CACHE['data'] = data
    _META_CACHE['mtime'] = mtime
    return data


def save_structure(data):
    _write_yaml(_metadata_path(), data)
    global _META_CACHE
    _META_CACHE['data'] = None
    _META_CACHE['mtime'] = -1.0
    _MERGED_CACHE['tree'] = None


# ---------- tree cache ----------

def load_tree_cache():
    global _cache
    tree = _load_yaml(_tree_path())
    if isinstance(tree, list):
        _cache['tree'] = tree
    else:
        _cache['tree'] = []
    _cache['yaml_mtime'] = _signal_mtime()
    return _cache['tree']


def invalidate_cache():
    global _cache, _META_CACHE, _MERGED_CACHE
    _cache = {'tree': None, 'yaml_mtime': 0.0}
    _META_CACHE = {'data': None, 'mtime': -1.0}
    _MERGED_CACHE = {'tree': None, 'sig_mtime': -1.0, 'meta_mtime': -1.0}

try:
    from yaml import CSafeLoader as _YamlLoader
except ImportError:  # pragma: no cover
    _YamlLoader = None

_META_CACHE = {'data': None, 'mtime': -1.0}
_MERGED_CACHE = {'tree': None, 'sig_mtime': -1.0, 'meta_mtime': -1.0}


def _load_yaml(path):
    """Parse a YAML file, preferring the C loader when available."""
    if not os.path.exists(path):
        return {}
    try:
        with open(path, 'r') as f:
            if _YamlLoader is not None:
                return yaml.load(f, Loader=_YamlLoader) or {}
            return yaml.safe_load(f) or {}
    except (yaml.YAMLError, OSError):
        return {}


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
            entry['children'] = [c for c in entry['children'] if not c.get('hidden')]


def get_course_tree(sorted=True):
    global _MERGED_CACHE
    sig_mtime = _signal_mtime()
    meta_mtime = _metadata_mtime()
    if (
        _MERGED_CACHE['tree'] is not None
        and _MERGED_CACHE['sig_mtime'] == sig_mtime
        and _MERGED_CACHE['meta_mtime'] == meta_mtime
    ):
        return _MERGED_CACHE['tree']

    tree = _ensure_cache()
    if not tree:
        return []
    import copy
    merged = copy.deepcopy(tree)
    metadata = load_structure()
    _merge_metadata(merged, metadata)
    merged = [e for e in merged if not e.get('hidden')]
    _mark_category_types(merged)
    if sorted:
        _sort_tree(merged)
    _MERGED_CACHE['tree'] = merged
    _MERGED_CACHE['sig_mtime'] = sig_mtime
    _MERGED_CACHE['meta_mtime'] = meta_mtime
    return merged


def _sort_tree(entries):
    """Sort entries: categories first, then by natural sort order (numeric prefix, then alphabetical)."""
    def sort_key(e):
        is_category = e.get('type') == 'category'
        name = e.get('name', '')
        sk = get_sort_key(name)
        return (0 if is_category else 1, sk, name.lower())

    entries.sort(key=sort_key)
    for e in entries:
        if 'children' in e:
            _sort_tree(e['children'])


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
            human = e.get('title') or e.get('name') or 'Untitled'
            current_path = path + [{'id': e.get('id'), 'name': human, 'title': human}]
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


def get_pdf_url(content_id):
    tree = _ensure_cache()

    def search(entries):
        for entry in entries:
            if entry.get('id') == content_id and entry.get('type') == 'pdf':
                return entry.get('path')
            if 'children' in entry:
                result = search(entry['children'])
                if result:
                    return result
        return None

    return search(tree)


def _filter_hidden(entries, metadata):
    """Return a copy of `entries` with admin-hidden items (and their subtrees)
    removed, mirroring the filtering done by `_merge_metadata`."""
    if not metadata:
        return entries
    result = []
    for e in entries:
        cfg = metadata.get(e.get('id')) or {}
        if cfg.get('hidden'):
            continue
        if 'children' in e:
            e = dict(e)
            e['children'] = _filter_hidden(e['children'], metadata)
        result.append(e)
    return result


def get_content_by_id(content_id, include_hidden=False):
    ws = get_workshop_content(content_id)
    if ws:
        metadata = load_structure()
        cid = ws['id']
        config = metadata.get(cid, {})
        ws['config'] = config
        ws.setdefault('prerequisites', config.get('prerequisites', []))
        ws.setdefault('lock_type', config.get('lock_type'))
        ws.setdefault('lock_value', config.get('lock_value'))
        return ws

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
        if 'children' in result and not include_hidden:
            result['children'] = _filter_hidden(result['children'], load_structure())
        _load_body_for_entry(result)
        if result.get('type') == 'practical':
            _attach_lab_content(result)
        metadata = load_structure()
        cid = result.get('id', '')
        config = metadata.get(cid, {})
        result['config'] = config
        result.setdefault('prerequisites', config.get('prerequisites', []))
        result.setdefault('lock_type', config.get('lock_type'))
        result.setdefault('lock_value', config.get('lock_value'))
        if 'image' in config:
            result['image'] = config['image']
    return result


def _attach_lab_content(entry):
    """Attach structured lab data (description/hints/seed/solution) to a practical entry.

    The course file carries the full freeCodeCamp source:
      # --description--
      # --hints--
      # --seed--          (with ## --seed-contents--)
      # --solutions--
    """
    body = entry.get('body', '')
    meta = entry.get('meta', {})
    description = _extract_fcc_section(body, 'description')
    hints_section = _extract_fcc_section(body, 'hints')
    seed_section = _extract_fcc_section(body, 'seed')
    solution_section = _extract_fcc_section(body, 'solutions')
    entry['description'] = description
    entry['hints'] = _extract_hints(hints_section)
    entry['seed_files'] = _extract_seed_files(seed_section)
    entry['solution'] = solution_section
    entry['step_count'] = 1
    if meta.get('title'):
        entry.setdefault('title', meta['title'])
    return entry


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
    tree = get_course_tree()
    ids = set()

    def walk(entries):
        for e in entries:
            if e.get('type') not in ('category',):
                ids.add(e['id'])
            if 'children' in e:
                walk(e['children'])

    walk(tree)
    return ids
