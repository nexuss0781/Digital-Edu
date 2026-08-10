"""
Offline asset localization.

Loads <course>/assets/manifest.json (written by scripts/download_course_assets.py)
and exposes `rewrites_for` so the API can attach a per-content rewrite list
mapping remote resource URLs to locally-served absolute paths.

Only entries with status "downloaded" are rewritable; "pending" (embeds/media)
and "missing" (404s) are left untouched.
"""

import os
import re
from functools import lru_cache

_ROUTE_PREFIX = '/api/v1/course-file'

_URL_RE = re.compile(r'https?://[^\s"\'`<>]+')


def _manifest_path(courses_dir, course_root):
    if not course_root:
        return None
    root = os.path.abspath(os.path.join(courses_dir, course_root))
    if os.path.commonpath([os.path.abspath(courses_dir), root]) != os.path.abspath(courses_dir):
        return None
    return os.path.join(root, 'assets', 'manifest.json')


@lru_cache(maxsize=16)
def load_manifest(courses_dir, course_root):
    path = _manifest_path(courses_dir, course_root)
    if not path or not os.path.isfile(path):
        return []
    try:
        import json
        with open(path, 'r', encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return []


def _text_urls(text):
    return set(_URL_RE.findall(text))


def rewrites_for(courses_dir, course_root, text):
    """Return [{from, to}] mapping downloaded remote resources found in `text`
    to their locally-served absolute URLs."""
    if not text:
        return []
    entries = load_manifest(courses_dir, course_root)
    if not entries:
        return []
    text_urls = _text_urls(text)
    rewrites = []
    for entry in entries:
        if entry.get('status') != 'downloaded':
            continue
        url = entry.get('url')
        if not url or url not in text_urls:
            continue
        local = entry.get('local', '')
        if not local:
            continue
        rewrites.append({
            'from': url,
            'to': f'{_ROUTE_PREFIX}/{course_root}/{local.lstrip("/")}',
        })
    rewrites.sort(key=lambda r: len(r['from']), reverse=True)
    return rewrites


def invalidate_manifest(courses_dir, course_root):
    load_manifest.cache_clear()
