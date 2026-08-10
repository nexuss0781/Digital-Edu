#!/usr/bin/env python3
"""
Restore exact freeCodeCamp workshop source files into the DigitalEdu course tree.

Each course workshop step (from scripts/workshop_groups.json) is joined to its
real freeCodeCamp challenge file by challenge id, and the source file is copied
VERBATIM (front matter + all sections: --description--, --hints--, --seed--,
--solutions--). No modification is made to the source content.

Usage:
    python3 scripts/restore_workshop_sources.py          # copy files
    python3 scripts/restore_workshop_sources.py --check  # dry-run, only report
"""
import json
import os
import shutil
import sys

GROUPS_FILE = "scripts/workshop_groups.json"
COURSE_DIR = "courses"
FCC_BLOCKS = os.path.expanduser(
    "~/Downloads/FCC/freeCodeCamp/curriculum/challenges/english/blocks"
)

CHECK = "--check" in sys.argv

with open(GROUPS_FILE, encoding="utf-8") as f:
    groups = json.load(f)["workshop_groups"]

total = ok = missing = 0
missing_list = []
skipped = []

for group in groups:
    parent = group["parent_id"]
    block = parent.split("/")[-1]
    src_dir = os.path.join(FCC_BLOCKS, block)

    if group.get("directory_path") == "test":
        skipped.append((parent, len(group["steps"])))
        continue

    if not os.path.isdir(src_dir):
        print(f"[MISSING-BLOCK] {block}")
        missing += len(group["steps"])
        continue

    for step in group["steps"]:
        total += 1
        short_id = step["id"].split("/")[-1]
        src = os.path.join(src_dir, short_id + ".md")
        dst = os.path.join(COURSE_DIR, step["path"])

        if not os.path.isfile(src):
            missing += 1
            missing_list.append((short_id, step["path"]))
            continue

        ok += 1
        if not CHECK:
            shutil.copyfile(src, dst)

print(f"steps: {total}  matched/copied: {ok}  missing: {missing}")
if skipped:
    print("skipped test-artifact groups:", skipped)
if missing_list:
    print("missing sources:")
    for sid, path in missing_list[:20]:
        print("  ", sid, path)
