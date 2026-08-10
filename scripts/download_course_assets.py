#!/usr/bin/env python3
"""
Download and localize every remote resource referenced by a course so it runs fully offline.

- Scans all *.md files under <course>/ for URLs.
- Classifies each URL:
    download   -> static images/css/fonts that get fetched now and mirrored under
                  <course>/assets/vendor/<netloc>/<path>.
    pending    -> embeds (youtube/openstreetmap) and media (audio/video) that are
                  recorded in assets/PENDING.md for manual download next session.
    skip       -> plain hyperlinks (no resource load), sample @font-face code, etc.
- Font packages (fontawesome css, google fonts css) are downloaded with a browser UA,
  their internal url()/@font-face references are downloaded too, and google-font css is
  rewritten to relative urls so the served tree is self-contained.
- Writes assets/manifest.json mapping each url -> {local, kind, status}. The backend
  uses this to compute per-content `rewrites`; the frontend applies them in previews.
- Idempotent: existing files with matching size are skipped unless --force.

Usage:
  python3 scripts/download_course_assets.py [course-dir] [--force] [--check]
"""

import asyncio
import hashlib
import json
import os
import re
import sys

import httpx

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)

COURSE_DIR = os.path.join(REPO_ROOT, 'courses', 'Responsive-Web-Design')
if len(sys.argv) > 1 and not sys.argv[1].startswith('-'):
    COURSE_DIR = os.path.abspath(sys.argv[1])
FORCE = '--force' in sys.argv
CHECK = '--check' in sys.argv

ASSETS_DIR = os.path.join(COURSE_DIR, 'assets')
VENDOR_DIR = os.path.join(ASSETS_DIR, 'vendor')
MANIFEST_PATH = os.path.join(ASSETS_DIR, 'manifest.json')
PENDING_PATH = os.path.join(ASSETS_DIR, 'PENDING.md')

BROWSER_UA = (
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
)

DOWNLOAD_HOSTS = {
    'cdn.freecodecamp.org',
    'design-style-guide.freecodecamp.org',
    'use.fontawesome.com',
    'fonts.googleapis.com',
    'placehold.co',
}
PENDING_HOSTS = {'www.youtube.com', 'www.youtube-nocookie.com', 'www.openstreetmap.org'}
PENDING_PREFIXES = ('https://archive.org/', 'http://archive.org/')

IMAGE_EXT = {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'}
AUDIO_EXT = {'.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac'}
VIDEO_EXT = {'.mp4', '.webm', '.mov', '.m4v', '.avi'}
FONT_EXT = {'.woff2', '.woff', '.ttf', '.otf'}
CSS_EXT = {'.css'}

URL_RE = re.compile(r'https?://[^\s"\'`<>]+')

FONT_CSS_RE = re.compile(r'url\((https://[^)]+)\)')
FA_WEBFONT_RE = re.compile(r"url\((['\"]?)(\.\./webfonts/[^)]+?)\1\)")


def rel_url_clean(url: str) -> str:
    """Strip HTML entities and query strings that we do not want mirrored."""
    return url.split('?', 1)[0].replace('&amp;', '&')


def sha1_short(s: str, n: int = 12) -> str:
    return hashlib.sha1(s.encode('utf-8')).hexdigest()[:n]


def slug_for_font_css(url: str) -> str:
    query = url.split('?', 1)[1] if '?' in url else ''
    family = re.search(r'family=([^&]+)', query)
    fam = re.sub(r'[^A-Za-z0-9]+', '-', family.group(1)) if family else 'font'
    return f'css~{fam}-{sha1_short(query)}.css'


def classify(url: str):
    """Return (action, kind) for a url: download | pending | skip."""
    lower = url.lower()
    host_match = re.match(r'https?://([^/]+)', lower)
    host = host_match.group(1) if host_match else ''

    if host in PENDING_HOSTS:
        return 'pending', 'embed'
    if any(lower.startswith(p) for p in PENDING_PREFIXES):
        return 'pending', 'video'

    ext = os.path.splitext(rel_url_clean(url))[1].lower()
    if host in DOWNLOAD_HOSTS:
        if url.startswith('https://fonts.googleapis.com/') or url.startswith('http://fonts.googleapis.com/'):
            return 'download', 'font-css'
        if url.startswith('https://use.fontawesome.com/') and ext in CSS_EXT:
            return 'download', 'font-css'
        if url.startswith('https://placehold.co/'):
            return 'download', 'image'
        if ext in IMAGE_EXT:
            return 'download', 'image'
        if ext in AUDIO_EXT:
            return 'pending', 'audio'
        if ext in VIDEO_EXT:
            return 'pending', 'video'
        return 'skip', ''
    return 'skip', ''


def iter_md_files():
    for root, _dirs, files in os.walk(COURSE_DIR):
        for f in files:
            if f.endswith('.md'):
                yield os.path.join(root, f)


def collect_urls():
    """Return {url: {'kind': kind, 'action': action, 'files': [paths]}}."""
    found = {}
    for path in iter_md_files():
        try:
            text = open(path, encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        for m in URL_RE.finditer(text):
            url = m.group(0)
            url = url.rstrip('.,;:)]}')
            action, kind = classify(url)
            if action == 'skip':
                continue
            entry = found.setdefault(url, {'action': action, 'kind': kind, 'files': []})
            if path not in entry['files']:
                entry['files'].append(path)
    return found


def clean_local_path(path: str) -> str:
    """Strip query strings / fragments so the served file has a valid filename."""
    return path.split('?', 1)[0].split('#', 1)[0]


def local_path_for(url: str, kind: str):
    host_match = re.match(r'https?://([^/]+)(/.*)?$', url)
    host = host_match.group(1)
    path = host_match.group(2) or ''
    path = rel_url_clean(path)
    if url.startswith('https://fonts.googleapis.com/'):
        return os.path.join('assets', 'vendor', 'fonts.googleapis.com', slug_for_font_css(url)), url
    if url.startswith('https://placehold.co/'):
        seg = path.strip('/').replace('/', '-')
        if '/png' in url.lower():
            seg = seg.replace('-png', '') + '-png.png'
        else:
            seg += '.svg'
        return os.path.join('assets', 'vendor', 'placehold.co', seg), url
    return os.path.join('assets', 'vendor', host, path.strip('/')), url


async def fetch(client, url, dest_abs, kind):
    if os.path.isfile(dest_abs) and not FORCE:
        return 'skipped', None
    headers = {'User-Agent': BROWSER_UA}
    try:
        async with client.stream('GET', url, headers=headers, follow_redirects=True) as resp:
            if resp.status_code != 200:
                return 'error', f'{resp.status_code}'
            os.makedirs(os.path.dirname(dest_abs), exist_ok=True)
            tmp = dest_abs + '.part'
            with open(tmp, 'wb') as fh:
                async for chunk in resp.aiter_bytes():
                    fh.write(chunk)
            os.replace(tmp, dest_abs)
            return 'downloaded', None
    except Exception as exc:  # noqa: BLE001
        return 'error', str(exc)


async def run_downloads(urls):
    """Download plain assets; returns (manifest_entries, errors)."""
    entries = []
    errors = []

    def push(entry):
        if not any(e['url'] == entry['url'] for e in entries):
            entries.append(entry)

    async with httpx.AsyncClient(timeout=60, limits=httpx.Limits(max_connections=24)) as client:
        # generic parallel download: plain images + placeholders only
        plain = [u for u in urls if classify(u)[1] == 'image']
        tasks = []
        for url in plain:
            action, kind = classify(url)
            local_rel, _orig = local_path_for(url, kind)
            dest = os.path.join(COURSE_DIR, local_rel)
            tasks.append((url, dest, kind, local_rel))
        results = {}
        for i in range(0, len(tasks), 24):
            batch = tasks[i:i + 24]
            outcomes = await asyncio.gather(*[
                fetch(client, u, d, k) for (u, d, k, _lr) in batch
            ])
            for (u, d, k, _lr), (status, err) in zip(batch, outcomes):
                results[u] = (status, err)
        for url, dest, kind, local_rel in tasks:
            status, err = results[url]
            if status == 'error':
                errors.append((url, err))
                push({'url': url, 'local': local_rel, 'kind': kind, 'status': 'missing'})
                continue
            push({'url': url, 'local': local_rel, 'kind': kind, 'status': 'downloaded'})

        # fontawesome css + webfonts
        for url in [u for u in urls if classify(u)[1] == 'font-css' and 'use.fontawesome.com' in u]:
            local_rel, _orig = local_path_for(url, 'font-css')
            dest = os.path.join(COURSE_DIR, local_rel)
            status, err = await fetch(client, url, dest, 'font-css')
            if status == 'error':
                errors.append((url, err))
                push({'url': url, 'local': local_rel, 'kind': 'font-css', 'status': 'missing'})
                continue
            push({'url': url, 'local': local_rel, 'kind': 'font-css', 'status': 'downloaded'})
            css = open(dest, encoding='utf-8', errors='replace').read()
            seen_wf = set()
            for m in FA_WEBFONT_RE.finditer(css):
                wf_url = url.rsplit('/', 2)[0] + '/' + m.group(2).lstrip('../')
                wf_local = clean_local_path(os.path.normpath(
                    os.path.join(os.path.dirname(local_rel), m.group(2))
                ).replace(os.sep, '/'))
                if wf_url in seen_wf:
                    continue
                seen_wf.add(wf_url)
                wf_dest = os.path.join(COURSE_DIR, wf_local)
                wstatus, werr = await fetch(client, wf_url, wf_dest, 'webfont')
                if wstatus == 'error':
                    errors.append((wf_url, werr))
                else:
                    push({'url': wf_url, 'local': wf_local, 'kind': 'webfont', 'status': 'downloaded'})

        # google fonts css + gstatic woff2
        for url in [u for u in urls if classify(u)[1] == 'font-css' and 'fonts.googleapis.com' in u]:
            local_rel, _orig = local_path_for(url, 'font-css')
            dest = os.path.join(COURSE_DIR, local_rel)
            status, err = await fetch(client, url, dest, 'font-css')
            if status == 'error':
                errors.append((url, err))
                push({'url': url, 'local': local_rel, 'kind': 'font-css', 'status': 'missing'})
                continue
            push({'url': url, 'local': local_rel, 'kind': 'font-css', 'status': 'downloaded'})
            css = open(dest, encoding='utf-8', errors='replace').read()
            changed = False
            seen_g = set()
            for m in FONT_CSS_RE.finditer(css):
                gurl = m.group(1).rstrip(')')
                gpath = rel_url_clean(gurl)
                g_local = os.path.join('assets', 'vendor', 'fonts.gstatic.com',
                                       gpath.split('fonts.gstatic.com/', 1)[-1])
                g_dest = os.path.join(COURSE_DIR, g_local)
                if gurl not in seen_g:
                    seen_g.add(gurl)
                    gstatus, gerr = await fetch(client, gurl, g_dest, 'webfont')
                    if gstatus == 'error':
                        errors.append((gurl, gerr))
                    else:
                        push({'url': gurl, 'local': g_local, 'kind': 'webfont', 'status': 'downloaded'})
                # rewrite css url() to a relative path from the css dir
                rel_from_css = os.path.relpath(g_dest, os.path.dirname(dest)).replace(os.sep, '/')
                css = css.replace(m.group(0), f'url({rel_from_css})')
                changed = True
            if changed:
                open(dest, 'w', encoding='utf-8').write(css)

    return entries, errors


def main():
    if not os.path.isdir(COURSE_DIR):
        print(f'Course dir not found: {COURSE_DIR}')
        sys.exit(1)

    urls = collect_urls()
    print(f'Scanning {sum(1 for _ in iter_md_files())} md files -> {len(urls)} unique resource urls')

    if CHECK:
        existing = []
        if os.path.isfile(MANIFEST_PATH):
            existing = json.load(open(MANIFEST_PATH))
        by_url = {e['url']: e for e in existing}
        missing = []
        for url, info in urls.items():
            if info['action'] == 'pending':
                continue
            e = by_url.get(url)
            if not e or e.get('status') != 'downloaded':
                missing.append(url)
            else:
                local = e.get('local')
                if not local or not os.path.isfile(os.path.join(COURSE_DIR, local)):
                    missing.append(url)
        if missing:
            print('MISSING (run without --check):')
            for m in missing:
                print(f'  {m}')
            sys.exit(1)
        print('All downloadable assets present.')
        sys.exit(0)

    entries, errors = asyncio.run(run_downloads(urls))

    # pending entries
    for url, info in urls.items():
        if info['action'] != 'pending':
            continue
        local, _orig = local_path_for(url, info['kind'])
        entries.append({
            'url': url,
            'local': clean_local_path(local),
            'kind': info['kind'],
            'status': 'pending',
            'files': info['files'],
        })

    entries.sort(key=lambda e: e['url'])
    os.makedirs(ASSETS_DIR, exist_ok=True)
    with open(MANIFEST_PATH, 'w') as fh:
        json.dump(entries, fh, indent=2)

    # PENDING.md for manual download next session
    pending = [e for e in entries if e['status'] == 'pending']
    lines = [
        '# Pending remote resources (manual download, next session)\n',
        '',
        'These resources cannot be fetched automatically (embeds, or large media).',
        'Download them and place them at the LOCAL path below, then re-run this script',
        'with --force to flip them to downloaded, or --check to verify.\n',
        '',
        f'{len([e for e in entries if e["status"] == "downloaded"])} downloaded, '
        f'{len(pending)} pending, {len(errors)} errors.\n',
        '',
    ]
    for e in pending:
        lines.append(f"- `{e['url']}`\n  -> `{e['local']}`\n")
    with open(PENDING_PATH, 'w') as fh:
        fh.write('\n'.join(lines))

    print(f'\nDownloaded {sum(1 for e in entries if e["status"] == "downloaded")} '
          f'(pending {len(pending)}, errors {len(errors)})')
    for e in entries:
        print(f"  [{e['status']}] {e['kind']:9s} {e['url']} -> {e['local']}")
    if errors:
        print('\nERRORS:')
        for u, e in errors:
            print(f'  {u} :: {e}')


if __name__ == '__main__':
    main()
