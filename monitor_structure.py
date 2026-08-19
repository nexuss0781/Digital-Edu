#!/usr/bin/env python3
"""
Monitor and cache the course directory structure.

Usage:
    python monitor_structure.py              # one-shot scan
    python monitor_structure.py --watch      # event-driven filesystem watch
    python monitor_structure.py --courses-dir /path/to/courses
"""

import os
import re
import sys
import time
import fnmatch
import argparse
import threading
import yaml
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from paths import WORKSHOP_GROUPS_JSON

STRUCTURE_FILE = 'course_structure.yaml'
SIGNAL_FILE = '.structure_updated'
COURSEIGNORE_FILE = '.courseignore'

FRONT_MATTER_RE = re.compile(r'^---\s*\n(.*?)\n---\s*\n(.*)', re.DOTALL)

_rescan_lock = threading.Lock()
_rescan_timer = None


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
        if fnmatch.fnmatch(norm, norm_pattern):
            return True
        if pattern.endswith('/'):
            if norm == norm_pattern or norm.startswith(norm_pattern + '/'):
                return True
            parts = norm.split('/')
            for part in parts:
                if fnmatch.fnmatch(part, norm_pattern):
                    return True
        parts = norm.split('/')
        for part in parts:
            if fnmatch.fnmatch(part, pattern):
                return True
    return False


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


_TITLE_ACRONYMS = {
    'html', 'css', 'js', 'api', 'json', 'pdf', 'svg', 'ai', 'ui', 'ux',
    'http', 'https', 'url', 'uri', 'dom', 'rgb', 'id', 'seo', 'sql', 'git', 'npm',
}


def name_to_title(name):
    name = name.replace('.md', '')
    name = re.sub(r'^[\d.\s]+', '', name).strip()
    name = re.sub(r'^[-_]+|[-_]+$', '', name)
    words = [w for w in re.split(r'[-_\s]+', name) if w]
    return ' '.join(
        w.upper() if w.lower() in _TITLE_ACRONYMS else w.capitalize()
        for w in words
    )


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


def normalize_type(raw):
    if not raw:
        return 'lecture'
    aliases = {
        'note': 'lecture', 'notes': 'lecture', 'lecture': 'lecture', 'lectures': 'lecture',
        'review': 'review', 'reviews': 'review',
        'pdf': 'pdf',
        'quiz': 'quiz', 'quizzes': 'quiz', 'quizs': 'quiz', 'quizes': 'quiz',
        'test': 'test', 'tests': 'test',
        'exam': 'exam', 'exams': 'exam',
        'workshop': 'workshop', 'workshops': 'workshop',
        'practical': 'practical', 'practicals': 'practical',
        'project': 'project', 'projects': 'project',
    }
    key = raw.strip().lower()
    return aliases.get(key, key)


def scan_directory(base_path, rel_path='', depth=0):
    entries = []
    full_path = os.path.join(base_path, rel_path)

    if not os.path.exists(full_path):
        return entries

    ignore_patterns = load_courseignore(base_path)
    try:
        names = sorted(os.listdir(full_path), key=get_sort_key)
    except OSError:
        return entries

    for name in names:
        entry_path = os.path.join(rel_path, name)
        full_entry_path = os.path.join(base_path, entry_path)

        rel_for_ignore = name if depth == 0 else entry_path.replace('\\', '/')
        if is_ignored(rel_for_ignore, base_path, ignore_patterns):
            continue

        content_id = path_to_id(entry_path)
        title = name_to_title(name)

        if os.path.isdir(full_entry_path):
            children = scan_directory(base_path, entry_path, depth + 1)
            if not children:
                continue
            entries.append({
                'name': name,
                'path': entry_path.replace('\\', '/'),
                'type': 'category',
                'id': content_id,
                'title': title,
                'sort_key': get_sort_key(name),
                'children': children,
                'depth': depth,
            })
        elif name.endswith('.md'):
            meta, _ = parse_front_matter(full_entry_path)
            ctype = normalize_type(meta.get('type', 'lecture'))
            entries.append({
                'name': name,
                'path': entry_path.replace('\\', '/'),
                'type': ctype,
                'id': meta.get('id', content_id),
                'title': meta.get('title', title),
                'sort_key': get_sort_key(name),
                'depth': depth,
            })
        elif name.lower().endswith('.pdf'):
            entries.append({
                'name': name,
                'path': entry_path.replace('\\', '/'),
                'type': 'pdf',
                'id': content_id,
                'title': title,
                'sort_key': get_sort_key(name),
                'depth': depth,
            })

    entries.sort(key=lambda e: e['sort_key'])
    return entries


def _get_workshop_groups():
    if not os.path.exists(WORKSHOP_GROUPS_JSON):
        return []
    try:
        import json
        with open(WORKSHOP_GROUPS_JSON, 'r') as f:
            data = json.load(f)
        return data.get('workshop_groups', [])
    except (json.JSONDecodeError, OSError):
        return []


def _remove_steps_and_insert_parents(tree, groups):
    step_to_parent = {}
    for g in groups:
        for s in g['steps']:
            step_to_parent[s['id']] = g

    _step_ids_all = set(step_to_parent.keys())

    def walk(entries):
        for e in entries:
            if e.get('type') == 'category' and 'children' in e:
                walk(e['children'])

        group_indices = {}
        for idx, entry in enumerate(entries):
            eid = entry.get('id')
            if eid in _step_ids_all:
                pid = step_to_parent[eid]['parent_id']
                if pid not in group_indices:
                    group_indices[pid] = []
                group_indices[pid].append(idx)

        if not group_indices:
            return

        groups_sorted = sorted(group_indices.items(), key=lambda x: x[1][0], reverse=True)
        for pid, indices in groups_sorted:
            g = step_to_parent[entries[indices[0]]['id']]
            parent_entry = {
                'name': g['title'],
                'path': g['directory_path'],
                'type': 'workshop',
                'id': pid,
                'title': g['title'],
                'step_count': g['step_count'],
            }
            pos = indices[0]
            for idx in reversed(indices):
                del entries[idx]
            entries.insert(pos, parent_entry)

    walk(tree)


def scan_courses(courses_dir):
    tree = scan_directory(courses_dir)
    groups = _get_workshop_groups()
    if groups:
        _remove_steps_and_insert_parents(tree, groups)
    return tree


def save_tree(tree, courses_dir):
    os.makedirs(courses_dir, exist_ok=True)
    struct_path = os.path.join(courses_dir, STRUCTURE_FILE)
    signal_path = os.path.join(courses_dir, SIGNAL_FILE)

    cleaned = _clean_tree(tree)

    with open(struct_path, 'w') as f:
        yaml.dump(cleaned, f, default_flow_style=False, allow_unicode=True)

    with open(signal_path, 'w') as f:
        f.write(str(time.time()))

    return struct_path


def _clean_tree(entries):
    cleaned = []
    for entry in entries:
        e = {k: v for k, v in entry.items() if k not in ('sort_key', 'depth')}
        if 'children' in e:
            e['children'] = _clean_tree(e['children'])
        cleaned.append(e)
    return cleaned


def _do_rescan(courses_dir):
    global _rescan_timer
    _rescan_timer = None
    with _rescan_lock:
        print(f'[monitor] Rescanning...')
        tree = scan_courses(courses_dir)
        save_tree(tree, courses_dir)
        print(f'[monitor] Updated ({len(tree)} top-level items)')


def _schedule_rescan(courses_dir, delay=1):
    global _rescan_timer
    if _rescan_timer is not None:
        _rescan_timer.cancel()
    _rescan_timer = threading.Timer(delay, _do_rescan, args=[courses_dir])
    _rescan_timer.daemon = True
    _rescan_timer.start()


class _CourseChangeHandler(FileSystemEventHandler):
    def __init__(self, courses_dir):
        self.courses_dir = courses_dir

    def _is_relevant(self, path):
        basename = os.path.basename(path)
        if basename in (STRUCTURE_FILE, SIGNAL_FILE, '.courseignore'):
            return False
        if basename.startswith('.'):
            return False
        return True

    def on_created(self, event):
        if not event.is_directory and self._is_relevant(event.src_path):
            _schedule_rescan(self.courses_dir)

    def on_modified(self, event):
        if not event.is_directory and self._is_relevant(event.src_path):
            _schedule_rescan(self.courses_dir)

    def on_deleted(self, event):
        if self._is_relevant(event.src_path):
            _schedule_rescan(self.courses_dir)

    def on_moved(self, event):
        if self._is_relevant(event.src_path) or self._is_relevant(event.dest_path):
            _schedule_rescan(self.courses_dir)


def start_watching(courses_dir):
    observer = Observer()
    handler = _CourseChangeHandler(courses_dir)
    observer.schedule(handler, courses_dir, recursive=True)
    observer.start()
    print(f'[monitor] Watching {courses_dir} for changes')
    return observer


def main():
    parser = argparse.ArgumentParser(description='Monitor course directory structure')
    parser.add_argument('--courses-dir', default=None,
                        help='Path to courses directory (default: auto-detect)')
    parser.add_argument('--watch', action='store_true',
                        help='Watch for filesystem changes (event-driven)')
    args = parser.parse_args()

    if args.courses_dir:
        courses_dir = args.courses_dir
    else:
        from paths import COURSES_DIR
        courses_dir = COURSES_DIR

    tree = scan_courses(courses_dir)
    path = save_tree(tree, courses_dir)
    print(f'[monitor] Scanned {len(tree)} top-level items -> {path}')

    if args.watch:
        observer = start_watching(courses_dir)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            observer.stop()
        observer.join()


if __name__ == '__main__':
    main()
