#!/usr/bin/env python3
"""
Add DigitalEdu front-matter (type field) to freeCodeCamp markdown files.

Maps freeCodeCamp challengeType to DigitalEdu content types:
  note, quiz, test, exam, workshop, practical, project
"""

import os
import re
import yaml
from pathlib import Path

# ── freeCodeCamp challengeType → DigitalEdu type mapping ──
FCC_TYPE_MAP = {
    0:  "workshop",    # html – standard coding challenge
    1:  "workshop",    # js – JavaScript challenge
    2:  "project",     # backend
    3:  "project",     # zipline / frontEndProject
    4:  "project",     # backEndProject
    5:  "project",     # jsProject
    6:  "workshop",    # modern – code quiz (actually coding)
    7:  "workshop",    # step – multi-step workshop
    8:  "quiz",        # quiz – multiple choice quiz
    9:  None,          # invalid – skip
    10: "project",     # pythonProject
    11: "note",        # video
    12: "practical",   # codeAllyPractice
    13: "project",     # codeAllyCert
    14: "project",     # multifileCertProject
    15: "practical",   # theOdinProject
    16: "project",     # colab
    17: "exam",        # exam
    18: "practical",   # msTrophy
    19: "quiz",        # multipleChoice – interactive lesson MCQ
    20: "quiz",        # python – Python interactive lesson
    21: "note",        # dialogue – dialogue scene
    22: "quiz",        # fillInTheBlank
    23: "project",     # multifilePythonCertProject
    24: "note",        # generic
    25: "practical",   # lab
    26: "practical",   # jsLab
    27: "practical",   # pyLab
    28: "quiz",        # dailyChallengeJs
    29: "quiz",        # dailyChallengePy
    30: "exam",        # examDownload
    31: "quiz",        # review
    32: "practical",   # freeCodeCampOsPractice
    33: "project",     # freeCodeCampOsCert
}

# ── freeCodeCamp block name prefix → DigitalEdu type (fallback) ──
BLOCK_PREFIX_MAP = {
    "lecture-":  "note",
    "workshop-": "workshop",
    "lab-":      "practical",
    "review-":   "note",
    "quiz-":     "quiz",
    "exam-":     "exam",
}

FRONT_MATTER_RE = re.compile(r'^(---\s*\n)(.*?)(\n---\s*\n)(.*)', re.DOTALL)


def detect_type_from_block(block_name: str) -> str:
    """Fallback: detect type from block directory name prefix."""
    for prefix, content_type in BLOCK_PREFIX_MAP.items():
        if block_name.startswith(prefix):
            return content_type
    return "note"


def resolve_type(challenge: dict, block_name: str) -> str:
    """Determine DigitalEdu type for a challenge."""
    ct = challenge.get("challengeType")
    if ct is not None and ct in FCC_TYPE_MAP:
        mapped = FCC_TYPE_MAP[ct]
        if mapped is None:
            return None  # skip invalid
        return mapped
    return detect_type_from_block(block_name)


def process_file(filepath: str, block_name: str) -> bool:
    """
    Add/update type field in front-matter.
    Returns True if file was modified.
    """
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    match = FRONT_MATTER_RE.match(content)
    if not match:
        return False

    before, fm_str, sep, body = match.groups()

    try:
        meta = yaml.safe_load(fm_str) or {}
    except yaml.YAMLError:
        meta = {}

    if not isinstance(meta, dict):
        return False

    # skip if type already set
    if "type" in meta:
        return False

    # determine type
    ct = meta.get("challengeType")
    if ct is not None:
        edu_type = FCC_TYPE_MAP.get(ct)
    else:
        edu_type = detect_type_from_block(block_name)

    if edu_type is None:
        return False

    meta["type"] = edu_type

    # rebuild front-matter
    new_fm = yaml.dump(meta, default_flow_style=False, allow_unicode=True, sort_keys=False).strip()
    new_content = f"{before}{new_fm}{sep}{body}"

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(new_content)

    return True


def main():
    import sys

    courses_dir = Path("/home/nexuss0781/Desktop/Nex/Digital-edu/courses")
    blocks_dir = Path("/tmp/freecodecamp/curriculum/challenges/english/bblocks")

    # if argument given, process only that course
    if len(sys.argv) > 1:
        course_path = courses_dir / sys.argv[1]
    else:
        course_path = courses_dir / "Responsive-Web-Design"

    if not course_path.exists():
        print(f"Course not found: {course_path}")
        return

    modified = 0
    skipped = 0
    errors = 0

    for md_file in sorted(course_path.rglob("*.md")):
        # extract block name from filename (e.g., "1.1.1.1-workshop-name.md" → "workshop-name")
        stem = md_file.stem
        # remove numeric prefix
        name_part = re.sub(r'^[\d.]+-', '', stem)
        block_name = name_part

        try:
            if process_file(str(md_file), block_name):
                modified += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"ERROR: {md_file}: {e}")
            errors += 1

    print(f"Done: {modified} modified, {skipped} skipped (already had type), {errors} errors")


if __name__ == "__main__":
    main()
