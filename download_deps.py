#!/usr/bin/env python3
"""
Download all frontend CDN dependencies for offline use.
Run once: python download_deps.py
"""
import os
import sys
import re
import urllib.request
import urllib.error
import zipfile
import io
import shutil
import tarfile
import ssl

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, 'static')
VENDOR = os.path.join(STATIC, 'vendor')

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def ensure_dir(path):
    os.makedirs(path, exist_ok=True)


def download_file(url, dest):
    print(f"  GET {url}")
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept-Encoding': 'identity',
        })
        resp = urllib.request.urlopen(req, context=ctx, timeout=120)
        data = resp.read()
        ensure_dir(os.path.dirname(dest))
        with open(dest, 'wb') as f:
            f.write(data)
        print(f"    -> {os.path.relpath(dest, BASE)} ({len(data):,} bytes)")
        return data
    except Exception as e:
        print(f"    FAILED: {e}")
        return None


def download_text(url):
    data = download_file(url, os.path.join(VENDOR, '.tmp_dl'))
    if data is None:
        return None
    try:
        os.remove(os.path.join(VENDOR, '.tmp_dl'))
    except:
        pass
    return data.decode('utf-8', errors='replace')


# ── Tailwind CSS ────────────────────────────────────────────────
def download_tailwind():
    print("\n[1/5] Tailwind CSS (CDN play script)")
    dest = os.path.join(VENDOR, 'tailwindcss', 'tailwind.js')
    if os.path.exists(dest):
        print("  Already exists, skipping")
        return
    download_file('https://cdn.tailwindcss.com', dest)


# ── Lucide Icons ────────────────────────────────────────────────
def download_lucide():
    print("\n[2/5] Lucide Icons")
    lucide_dir = os.path.join(VENDOR, 'lucide')
    ensure_dir(lucide_dir)

    # Download the tarball from npm
    tarball_url = 'https://registry.npmjs.org/lucide-static/-/lucide-static-0.468.0.tgz'
    data = download_file(tarball_url, os.path.join(lucide_dir, '_pkg.tgz'))
    if not data:
        # Fallback: try latest
        tarball_url = 'https://registry.npmjs.org/lucide-static/-/lucide-static-latest.tgz'
        data = download_file(tarball_url, os.path.join(lucide_dir, '_pkg.tgz'))
    if not data:
        print("  Could not download lucide-static package")
        return

    print("  Extracting font files...")
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tf:
        for member in tf.getmembers():
            # Extract font directory files
            if '/font/' in member.name and any(
                member.name.endswith(ext) for ext in ('.css', '.woff2', '.woff', '.ttf', '.eot')
            ):
                fname = os.path.basename(member.name)
                target = os.path.join(lucide_dir, fname)
                with tf.extractfile(member) as src:
                    with open(target, 'wb') as dst:
                        shutil.copyfileobj(src, dst)
                print(f"    Extracted: {fname}")

    # Rewrite lucide.css to use local relative paths
    css_path = os.path.join(lucide_dir, 'lucide.css')
    if os.path.exists(css_path):
        with open(css_path, 'r', encoding='utf-8') as f:
            css = f.read()
        # Replace all url() references to point to local files
        css = re.sub(r'url\(["\']?[^"\')\s]*?/font/([^"\')\s]+)', r'url("\1"', css)
        with open(css_path, 'w', encoding='utf-8') as f:
            f.write(css)
        print("  Rewrote lucide.css for local paths")

    # Cleanup
    try:
        os.remove(os.path.join(lucide_dir, '_pkg.tgz'))
    except:
        pass


# ── Google Fonts ────────────────────────────────────────────────
def download_fonts():
    print("\n[3/5] Google Fonts (Inter + Playfair Display)")
    fonts_dir = os.path.join(VENDOR, 'fonts')
    ensure_dir(fonts_dir)

    # Download the Google Fonts CSS (with user-agent for woff2)
    css_url = (
        'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900'
        '&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap'
    )
    req = urllib.request.Request(css_url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })
    resp = urllib.request.urlopen(req, context=ctx, timeout=60)
    css = resp.read().decode('utf-8')

    # Extract all font URLs
    font_urls = re.findall(r'url\((https://fonts\.gstatic\.com/[^)]+)\)', css)
    print(f"  Found {len(font_urls)} font files to download")

    # Download each font and build a mapping
    url_map = {}
    for i, font_url in enumerate(font_urls):
        # Determine a readable filename from the surrounding CSS context
        idx = css.index(font_url)
        block_start = css.rfind('@font-face', 0, idx)
        block = css[block_start:css.index('}', idx) + 1] if block_start >= 0 else ''

        family = re.search(r"font-family:\s*'([^']+)'", block)
        weight = re.search(r'font-weight:\s*(\d+)', block)
        style = re.search(r'font-style:\s*(\w+)', block)

        fam = family.group(1).lower().replace(' ', '-') if family else f'font{i}'
        wgt = weight.group(1) if weight else '400'
        sty = style.group(1) if style else 'normal'

        ext = 'woff2' if '.woff2' in font_url else ('woff' if '.woff' in font_url else 'ttf')
        fname = f"{fam}-{wgt}{'-italic' if sty == 'italic' else ''}.{ext}"

        dest = os.path.join(fonts_dir, fname)
        if not os.path.exists(dest):
            download_file(font_url, dest)

        url_map[font_url] = fname

    # Rewrite CSS with local paths
    for remote_url, local_name in url_map.items():
        css = css.replace(remote_url, local_name)

    with open(os.path.join(fonts_dir, 'fonts.css'), 'w', encoding='utf-8') as f:
        f.write(css)
    print(f"  Saved fonts.css with {len(url_map)} font references")


# ── Monaco Editor ───────────────────────────────────────────────
def download_monaco():
    print("\n[4/5] Monaco Editor 0.45.0")
    monaco_dir = os.path.join(VENDOR, 'monaco-editor')
    min_dir = os.path.join(monaco_dir, 'min')

    if os.path.isdir(min_dir) and os.listdir(min_dir):
        print("  Already exists, skipping")
        return

    ensure_dir(monaco_dir)
    tarball_url = 'https://registry.npmjs.org/monaco-editor/-/monaco-editor-0.45.0.tgz'
    data = download_file(tarball_url, os.path.join(monaco_dir, '_pkg.tgz'))
    if not data:
        print("  FAILED to download Monaco editor")
        return

    print("  Extracting min/vs/ directory (may take a moment)...")
    extracted = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tf:
        for member in tf.getmembers():
            if member.name.startswith('package/min/'):
                rel = member.name[len('package/'):]
                target = os.path.join(monaco_dir, rel)
                if member.isdir():
                    ensure_dir(target)
                else:
                    ensure_dir(os.path.dirname(target))
                    with tf.extractfile(member) as src:
                        with open(target, 'wb') as dst:
                            shutil.copyfileobj(src, dst)
                    extracted += 1

    print(f"  Extracted {extracted} files")

    # Also copy the LICENSE
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tf:
            for member in tf.getmembers():
                if member.name == 'package/LICENSE':
                    with tf.extractfile(member) as src:
                        with open(os.path.join(monaco_dir, 'LICENSE'), 'wb') as dst:
                            shutil.copyfileobj(src, dst)
    except:
        pass

    # Cleanup
    try:
        os.remove(os.path.join(monaco_dir, '_pkg.tgz'))
    except:
        pass

    print(f"  Monaco editor ready at {os.path.relpath(monaco_dir, BASE)}")


# ── Unsplash Images ─────────────────────────────────────────────
def download_images():
    print("\n[5/5] Unsplash Course Images")
    img_dir = os.path.join(VENDOR, 'images')
    ensure_dir(img_dir)

    images = {
        'course-1.jpg': 'https://images.unsplash.com/photo-1507721999472-8ed4421c4af2?w=1200&q=80',
        'course-2.jpg': 'https://images.unsplash.com/photo-1579468118864-1b9ea3c0db4a?w=1200&q=80',
        'course-3.jpg': 'https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=1200&q=80',
        'course-4.jpg': 'https://images.unsplash.com/photo-1526379095098-d400fd0bf935?w=1200&q=80',
        'course-5.jpg': 'https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&q=80',
        'course-6.jpg': 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&q=80',
        'course-7.jpg': 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&q=80',
    }

    for fname, url in images.items():
        dest = os.path.join(img_dir, fname)
        if os.path.exists(dest):
            print(f"  {fname} already exists, skipping")
        else:
            download_file(url, dest)


# ── Main ────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("  Downloading all frontend CDN dependencies")
    print(f"  Target: {VENDOR}")
    print("=" * 60)

    ensure_dir(VENDOR)

    download_tailwind()
    download_lucide()
    download_fonts()
    download_monaco()
    download_images()

    print("\n" + "=" * 60)
    print("  DONE! All dependencies downloaded to static/vendor/")
    print("=" * 60)


if __name__ == '__main__':
    main()
