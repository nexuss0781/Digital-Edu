#!/usr/bin/env python3
"""
Restore exact freeCodeCamp lab (practical) sources into the DigitalEdu course tree.

Each course practical file (type: practical, id: rwd/{block}/{hex}) is matched to
its real freeCodeCamp challenge by hex id. The file is regenerated with DigitalEdu
front matter (id/title/type) plus the FULL original body: --description--,
--hints--, --seed-- (with ## --seed-contents--), --solutions--.

All cdn.freecodecamp.org asset URLs are replaced with local references under
courses/Responsive-Web-Design/assets/, and any referenced asset file that is not
already present locally is downloaded once into that directory.

Usage:
    python3 scripts/restore_lab_sources.py          # regenerate files + download assets
    python3 scripts/restore_lab_sources.py --check  # dry-run, only report
"""
import os
import re
import sys
import yaml

try:
    from urllib.request import urlopen
    from urllib.request import Request
except ImportError:  # pragma: no cover
    urlopen = None
    Request = None

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)

COURSE_DIR = "courses"
RWD_DIR = os.path.join(COURSE_DIR, "Responsive-Web-Design")
ASSETS_DIR = os.path.join(RWD_DIR, "assets")
FCC_BLOCKS = os.path.expanduser(
    "~/Downloads/FCC/freeCodeCamp/curriculum/challenges/english/blocks"
)

CHECK = "--check" in sys.argv

CDN_URL_RE = re.compile(r"https://cdn\.freecodecamp\.org/[^\s`\"()]+")
FRONT_MATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)", re.DOTALL)


def local_ref(url):
    """Map a cdn.freecodecamp.org URL to a local ../assets/ reference."""
    base = os.path.basename(url.rstrip("/."))
    return f"../assets/{base}"


def cdn_assets(body):
    """All unique cdn.freecodecamp.org URLs in a body, for downloading."""
    return sorted(set(CDN_URL_RE.findall(body)))


def practical_files():
    found = []
    for root, _dirs, files in os.walk(RWD_DIR):
        if "assets" in root:
            continue
        for fname in files:
            if not fname.endswith(".md"):
                continue
            path = os.path.join(root, fname)
            with open(path, encoding="utf-8") as f:
                head = f.read(4096)
            if re.search(r"^type:\s*practical", head, re.MULTILINE):
                found.append(path)
    return sorted(found)


def parse_id(path):
    with open(path, encoding="utf-8") as f:
        content = f.read()
    m = FRONT_MATTER_RE.match(content)
    if not m:
        return None
    meta = yaml.safe_load(m.group(1)) or {}
    cid = meta.get("id", "")
    parts = cid.split("/")
    if len(parts) != 3 or parts[0] != "rwd":
        return None
    return parts[1], parts[2], meta.get("title", "")


def main():
    files = practical_files()
    total = ok = missing = skipped = 0
    missing_list = []
    to_download = set()

    for path in files:
        total += 1
        info = parse_id(path)
        if not info:
            skipped += 1
            print(f"[SKIP] no rwd/{block}/{hex} id: {path}")
            continue
        block, hex_id, title = info
        src = os.path.join(FCC_BLOCKS, block, hex_id + ".md")
        if not os.path.isfile(src):
            missing += 1
            missing_list.append((block, hex_id, path))
            continue

        with open(src, encoding="utf-8") as f:
            content = f.read()
        m = FRONT_MATTER_RE.match(content)
        if not m:
            missing += 1
            missing_list.append((block, hex_id, path))
            continue

        body = m.group(2).strip()
        to_download.update(cdn_assets(body))
        body = CDN_URL_RE.sub(lambda mm: local_ref(mm.group(0)), body)

        front = {
            "id": f"rwd/{block}/{hex_id}",
            "title": title,
            "type": "practical",
        }
        front_yaml = yaml.dump(front, default_flow_style=False, allow_unicode=True).strip()
        out = f"---\n{front_yaml}\n---\n\n{body}\n"

        ok += 1
        if not CHECK:
            with open(path, "w", encoding="utf-8") as f:
                f.write(out)

    print(f"labs: {total}  matched/written: {ok}  missing: {missing}  skipped: {skipped}")
    if missing_list:
        print("missing sources:")
        for block, hex_id, path in missing_list:
            print("  ", block, hex_id, path)

    assets_needed = set()
    for url in sorted(to_download):
        fname = os.path.basename(url.rstrip("/."))
        dst = os.path.join(ASSETS_DIR, fname)
        if os.path.isfile(dst):
            continue
        assets_needed.add((url, fname))
    if not assets_needed:
        print("assets: all referenced cdn assets already present locally")
    else:
        print(f"assets: {len(assets_needed)} need download:")
        for url, fname in sorted(assets_needed):
            print("  ", fname, "<-", url)
        if not CHECK and urlopen:
            os.makedirs(ASSETS_DIR, exist_ok=True)
            for url, fname in sorted(assets_needed):
                try:
                    req = Request(url, headers={"User-Agent": USER_AGENT})
                    with urlopen(req, timeout=60) as resp, open(
                        os.path.join(ASSETS_DIR, fname), "wb"
                    ) as out:
                        out.write(resp.read())
                    print("   downloaded", fname)
                except Exception as exc:  # noqa: BLE001
                    print("   FAILED", fname, exc)


if __name__ == "__main__":
    main()
