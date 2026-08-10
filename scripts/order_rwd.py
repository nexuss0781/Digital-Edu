#!/usr/bin/env python3
"""
Rename all RWD course files with hierarchical numeric prefixes.
Format: 1, 1.1, 1.1.1, 1.1.2, 1.2, 1.2.1 ...
Also renames directories to match.
"""
import os
import re
import json
import yaml
import shutil

STRUCTURE_FILE = "/tmp/freecodecamp/curriculum/structure/superblocks/responsive-web-design-v9.json"
COURSE_DIR = "/home/nexuss0781/Desktop/Nex/Digital-edu/courses/Responsive Web Design"

def get_block_dir_name(block_name):
    mapping = {
        "basic-html": "basic-html",
        "basic-css": "basic-css",
        "css-flexbox": "css-flexbox",
        "css-grid": "css-grid",
    }
    if block_name in mapping:
        return mapping[block_name]
    return block_name

def find_module_dir(chapter_dir, module_name):
    if os.path.isdir(os.path.join(chapter_dir, module_name)):
        return os.path.join(chapter_dir, module_name)
    for d in os.listdir(chapter_dir):
        full = os.path.join(chapter_dir, d)
        if os.path.isdir(full) and module_name in d:
            return full
    return os.path.join(chapter_dir, module_name)

def find_block_files(module_dir, block_name):
    files = []
    for f in sorted(os.listdir(module_dir)):
        if f.startswith(block_name) and f.endswith('.md') and not f.startswith('_'):
            files.append(f)
    return sorted(files)

def rename_file_with_prefix(old_path, new_name):
    dir_path = os.path.dirname(old_path)
    new_path = os.path.join(dir_path, new_name)
    if old_path != new_path:
        os.rename(old_path, new_path)
    return new_path

def main():
    with open(STRUCTURE_FILE) as f:
        structure = json.load(f)

    chapter_num = 0

    for chapter in structure["chapters"]:
        chapter_num += 1
        ch_name = chapter["dashedName"]
        ch_type = chapter.get("chapterType", "standard")
        modules = chapter.get("modules", [])

        chapter_dir = os.path.join(COURSE_DIR, ch_name)

        if ch_type == "exam":
            exam_dir_name = f"{chapter_num}-{ch_name}"
            if os.path.isdir(chapter_dir):
                new_chapter_dir = os.path.join(COURSE_DIR, exam_dir_name)
                if chapter_dir != new_chapter_dir:
                    os.rename(chapter_dir, new_chapter_dir)
                    chapter_dir = new_chapter_dir

            for mi, module in enumerate(modules):
                for bi, block_name in enumerate(module["blocks"]):
                    files = find_block_files(chapter_dir, block_name)
                    for fi, fname in enumerate(files):
                        old_path = os.path.join(chapter_dir, fname)
                        ext = fname.replace(block_name, '').replace('.md', '')
                        new_name = f"{chapter_num}-exam{ext}.md"
                        rename_file_with_prefix(old_path, new_name)
                        print(f"  {new_name}")
            continue

        new_chapter_dir_name = f"{chapter_num}-{ch_name}"
        if os.path.isdir(chapter_dir) and chapter_dir != os.path.join(COURSE_DIR, new_chapter_dir_name):
            new_path = os.path.join(COURSE_DIR, new_chapter_dir_name)
            os.rename(chapter_dir, new_path)
            chapter_dir = new_path

        module_num = 0
        for module in modules:
            module_num += 1
            mod_name = module["dashedName"]
            mod_type = module.get("moduleType", "standard")
            blocks = module["blocks"]

            module_dir = find_module_dir(chapter_dir, mod_name)
            new_module_dir_name = f"{chapter_num}.{module_num}-{mod_name}"
            new_module_dir = os.path.join(chapter_dir, new_module_dir_name)

            if os.path.isdir(module_dir) and module_dir != new_module_dir:
                os.rename(module_dir, new_module_dir)
                module_dir = new_module_dir

            block_num = 0
            for block_name in blocks:
                block_num += 1
                files = find_block_files(module_dir, block_name)

                for fi, fname in enumerate(files):
                    old_path = os.path.join(module_dir, fname)
                    if not os.path.isfile(old_path):
                        continue

                    if len(files) == 1:
                        new_fname = f"{chapter_num}.{module_num}.{block_num}-{block_name}.md"
                    else:
                        new_fname = f"{chapter_num}.{module_num}.{block_num}.{fi+1}-{block_name}.md"

                    rename_file_with_prefix(old_path, new_fname)

                if files:
                    print(f"  {chapter_num}.{module_num}.{block_num} {block_name} ({len(files)} files)")

    print(f"\n{'='*60}")
    print("DONE! All files renamed with numeric prefixes.")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
