#!/usr/bin/env python3
"""
Convert freeCodeCamp Responsive Web Design curriculum to DigitalEdu format.
Version 2: Handles block name mapping between JSON structure and actual directories.
"""
import os
import re
import json
import yaml
from pathlib import Path

FCC_CURRICULUM = "/tmp/freecodecamp/curriculum/challenges/english/blocks"
STRUCTURE_FILE = "/tmp/freecodecamp/curriculum/structure/superblocks/responsive-web-design-v9.json"
OUTPUT_DIR = "/home/nexuss0781/Desktop/Nex/Digital-edu/courses/Responsive Web Design"

FRONT_MATTER_RE = re.compile(r'^---\s*\n(.*?)\n---\s*\n(.*)', re.DOTALL)

BLOCK_NAME_MAP = {
    "basic-html": "basic-html-and-html5",
    "workshop-cafe-menu": "learn-basic-css-by-building-a-cafe-menu",
    "workshop-piano": "learn-responsive-web-design-by-building-a-piano",
    "workshop-magazine": "learn-css-grid-by-building-a-magazine",
    "workshop-flexbox-photo-gallery": "learn-css-flexbox-by-building-a-photo-gallery",
    "workshop-city-skyline": "learn-css-variables-by-building-a-city-skyline",
    "workshop-ferris-wheel": "learn-css-animation-by-building-a-ferris-wheel",
    "workshop-flappy-penguin": "learn-css-transforms-by-building-a-penguin",
    "workshop-nutritional-label": "learn-typography-by-building-a-nutrition-label",
    "workshop-accessibility-quiz": "learn-accessibility-by-building-a-quiz",
    "workshop-rothko-painting": "learn-the-css-box-model-by-building-a-rothko-painting",
    "workshop-colored-markers": "learn-css-colors-by-building-a-set-of-colored-markers",
    "workshop-registration-form": "learn-html-forms-by-building-a-registration-form",
    "workshop-colorful-boxes": "learn-css-colors-by-building-a-set-of-colored-markers",
    "workshop-greeting-card": "learn-css-animation-by-building-a-ferris-wheel",
    "workshop-parent-teacher-conference-form": "learn-html-forms-by-building-a-registration-form",
    "workshop-balanced-sheet": "learn-more-about-css-pseudo-selectors-by-building-a-balance-sheet",
    "workshop-cat-painting": "learn-intermediate-css-by-building-a-cat-painting",
    "workshop-balance-sheet": "learn-more-about-css-pseudo-selectors-by-building-a-balance-sheet",
    "workshop-hotel-feedback-form": "learn-html-forms-by-building-a-registration-form",
    "workshop-final-exams-table": "learn-html-forms-by-building-a-registration-form",
    "workshop-major-browsers-list": "learn-html-by-building-a-cat-photo-app",
    "workshop-quincys-job-tips": "learn-html-by-building-a-cat-photo-app",
    "workshop-blog-page": "learn-html-by-building-a-cat-photo-app",
    "workshop-tech-conference-schedule": "learn-html-by-building-a-cat-photo-app",
    "workshop-accessible-audio-controller": "learn-html-by-building-a-cat-photo-app",
    "workshop-video-display-using-iframe": "learn-html-by-building-a-cat-photo-app",
    "workshop-heart-icon": "learn-html-by-building-a-cat-photo-app",
    "workshop-bookstore-page": "learn-html-by-building-a-cat-photo-app",
    "workshop-travel-agency-page": "learn-html-by-building-a-cat-photo-app",
    "workshop-html-music-player": "learn-html-by-building-a-cat-photo-app",
    "workshop-html-video-player": "learn-html-by-building-a-cat-photo-app",
    "workshop-build-a-heart-icon": "learn-html-by-building-a-cat-photo-app",
    "workshop-build-a-video-display-using-iframe": "learn-html-by-building-a-cat-photo-app",
    "lab-recipe-page": "learn-html-by-building-a-cat-photo-app",
    "lab-debug-camperbots-profile-page": "learn-html-by-building-a-cat-photo-app",
    "lab-debug-pet-adoption-page": "learn-html-by-building-a-cat-photo-app",
    "lab-travel-agency-page": "learn-html-by-building-a-cat-photo-app",
    "lab-html-audio-and-video-player": "learn-html-by-building-a-cat-photo-app",
    "lab-video-compilation-page": "learn-html-by-building-a-cat-photo-app",
    "lab-book-catalog-table": "learn-html-forms-by-building-a-registration-form",
    "lab-event-hub": "learn-html-by-building-a-cat-photo-app",
    "lab-checkout-page": "learn-html-by-building-a-cat-photo-app",
    "lab-movie-review-page": "learn-html-by-building-a-cat-photo-app",
    "lab-multimedia-player": "learn-html-by-building-a-cat-photo-app",
    "lab-survey-form": "learn-html-forms-by-building-a-registration-form",
    "lab-business-card": "learn-basic-css-by-building-a-cafe-menu",
    "lab-stylized-to-do-list": "learn-basic-css-by-building-a-cafe-menu",
    "lab-blog-post-card": "learn-basic-css-by-building-a-cafe-menu",
    "lab-event-flyer-page": "learn-basic-css-by-building-a-cafe-menu",
    "lab-job-application-form": "learn-html-forms-by-building-a-registration-form",
    "lab-colored-boxes": "learn-css-colors-by-building-a-set-of-colored-markers",
    "lab-contact-form": "learn-html-forms-by-building-a-registration-form",
    "lab-feature-selection": "learn-html-forms-by-building-a-registration-form",
    "lab-confidential-email-page": "learn-basic-css-by-building-a-cafe-menu",
    "lab-pricing-plans-layout": "learn-css-flexbox-by-building-a-photo-gallery",
    "lab-page-of-playing-cards": "learn-css-flexbox-by-building-a-photo-gallery",
    "lab-newspaper-article": "learn-css-grid-by-building-a-magazine",
    "lab-tribute-page": "learn-accessibility-by-building-a-quiz",
    "lab-house-painting": "learn-intermediate-css-by-building-a-cat-painting",
    "lab-book-inventory-app": "learn-more-about-css-pseudo-selectors-by-building-a-balance-sheet",
    "lab-technical-documentation-page": "learn-responsive-web-design-by-building-a-piano",
    "lab-availability-table": "learn-css-variables-by-building-a-city-skyline",
    "lab-newspaper-layout": "learn-css-grid-by-building-a-magazine",
    "lab-product-landing-page": "learn-css-grid-by-building-a-magazine",
    "lab-moon-orbit": "learn-css-animation-by-building-a-ferris-wheel",
    "lab-personal-portfolio": "learn-css-animation-by-building-a-ferris-wheel",
}

TYPE_MAP = {
    "lecture-": "note",
    "workshop-": "workshop",
    "lab-": "workshop",
    "review-": "note",
    "quiz-": "quiz",
    "exam-": "exam",
    "learn-": "workshop",
}


def detect_type(block_name):
    for prefix, content_type in TYPE_MAP.items():
        if block_name.startswith(prefix):
            return content_type
    return "note"


def title_from_name(block_name):
    return block_name.replace("-", " ").replace("_", " ").title()


def resolve_block_dir(block_name):
    if block_name in BLOCK_NAME_MAP:
        actual_name = BLOCK_NAME_MAP[block_name]
        actual_dir = os.path.join(FCC_CURRICULUM, actual_name)
        if os.path.isdir(actual_dir):
            return actual_dir, actual_name

    direct_dir = os.path.join(FCC_CURRICULUM, block_name)
    if os.path.isdir(direct_dir):
        return direct_dir, block_name

    return None, None


def read_fcc_block(block_name):
    block_dir, actual_name = resolve_block_dir(block_name)
    if not block_dir:
        return None

    files = sorted([f for f in os.listdir(block_dir) if f.endswith(".md")])
    if not files:
        return None

    challenges = []
    for fname in files:
        fpath = os.path.join(block_dir, fname)
        with open(fpath, "r", encoding="utf-8") as f:
            content = f.read()

        match = FRONT_MATTER_RE.match(content)
        if match:
            front_matter_str, body = match.groups()
            try:
                front_matter = yaml.safe_load(front_matter_str)
            except yaml.YAMLError:
                front_matter = {}
        else:
            front_matter = {}
            body = content

        challenges.append({
            "id": front_matter.get("id", fname.replace(".md", "")),
            "title": front_matter.get("title", title_from_name(block_name)),
            "challengeType": front_matter.get("challengeType", 0),
            "body": body,
            "filename": fname,
        })

    return challenges


def convert_challenge_to_markdown(challenge, block_name, content_type):
    title = challenge["title"]
    body = challenge["body"]

    body = re.sub(r'^# --description--\s*\n', '', body, flags=re.MULTILINE)
    body = re.sub(r'^# --instructions--\s*\n', '## Instructions\n\n', body, flags=re.MULTILINE)
    body = re.sub(r'^# --hints--\s*\n', '', body, flags=re.MULTILINE)
    body = re.sub(r'^# --seed--\s*\n', '', body, flags=re.MULTILINE)
    body = re.sub(r'^## --seed-contents--\s*\n', '', body, flags=re.MULTILINE)
    body = re.sub(r'^# --solutions--\s*\n', '', body, flags=re.MULTILINE)
    body = re.sub(r'^# --tests--\s*\n', '', body, flags=re.MULTILINE)
    body = re.sub(r'```js\nassert\..*?```', '', body, flags=re.DOTALL)
    body = re.sub(r':::interactive_editor\n(.*?)\n:::', r'```\n\1\n```', body, flags=re.DOTALL)
    body = re.sub(r'--fcc-editable-region--\n', '', body)

    if content_type == "quiz":
        body = convert_quiz_format(body)

    front = {
        "id": f"rwd/{block_name}/{challenge['id']}",
        "title": title,
        "type": content_type,
    }

    if content_type == "workshop":
        seed_match = re.search(r'```html\n(.*?)```', body, re.DOTALL)
        if seed_match:
            front["starterCode"] = seed_match.group(1).strip()

    front_yaml = yaml.dump(front, default_flow_style=False, allow_unicode=True).strip()
    return f"---\n{front_yaml}\n---\n\n# {title}\n\n{body}"


def convert_quiz_format(body):
    body = re.sub(r'^# --question--\s*\n', '## Question\n\n', body, flags=re.MULTILINE)
    body = re.sub(r'^# --distractors--\s*\n', '### Wrong Answers\n\n', body, flags=re.MULTILINE)
    body = re.sub(r'^# --answer--\s*\n', '### Correct Answer\n\n', body, flags=re.MULTILINE)
    return body


def create_module_structure(chapter_name, modules, output_dir):
    os.makedirs(output_dir, exist_ok=True)

    order_items = []

    for module in modules:
        module_name = module["dashedName"]
        module_type = module.get("moduleType", "standard")
        blocks = module["blocks"]

        module_dir = os.path.join(output_dir, module_name)
        os.makedirs(module_dir, exist_ok=True)

        module_order = {
            "id": f"rwd/{chapter_name}/{module_name}",
            "title": title_from_name(module_name),
            "type": "category",
            "children": []
        }

        for block_name in blocks:
            content_type = detect_type(block_name)
            challenges = read_fcc_block(block_name)

            if not challenges:
                print(f"  SKIP (no content): {block_name}")
                continue

            if content_type == "quiz":
                quiz_file = os.path.join(module_dir, f"{block_name}.md")
                md_content = convert_challenge_to_markdown(challenges[0], block_name, content_type)
                with open(quiz_file, "w", encoding="utf-8") as f:
                    f.write(md_content)

                module_order["children"].append({
                    "id": f"rwd/{chapter_name}/{module_name}/{block_name}",
                    "name": f"{block_name}.md",
                    "path": f"Responsive Web Design/{chapter_name}/{module_name}/{block_name}.md",
                    "title": title_from_name(block_name),
                    "type": "quiz",
                })
                print(f"  QUIZ: {block_name} ({len(challenges)} questions)")
            else:
                for i, challenge in enumerate(challenges):
                    md_content = convert_challenge_to_markdown(challenge, block_name, content_type)

                    suffix = f"_{i+1}" if len(challenges) > 1 else ""
                    md_file = os.path.join(module_dir, f"{block_name}{suffix}.md")

                    with open(md_file, "w", encoding="utf-8") as f:
                        f.write(md_content)

                    module_order["children"].append({
                        "id": f"rwd/{chapter_name}/{module_name}/{block_name}{suffix}",
                        "name": f"{block_name}{suffix}.md",
                        "path": f"Responsive Web Design/{chapter_name}/{module_name}/{block_name}{suffix}.md",
                        "title": challenge["title"],
                        "type": content_type,
                    })

                print(f"  {content_type.upper()}: {block_name} ({len(challenges)} files)")

        order_items.append(module_dir)
        module_order_file = os.path.join(module_dir, "_order.yaml")
        with open(module_order_file, "w", encoding="utf-8") as f:
            yaml.dump(module_order, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    return order_items


def main():
    with open(STRUCTURE_FILE, "r") as f:
        structure = json.load(f)

    if os.path.exists(OUTPUT_DIR):
        import shutil
        shutil.rmtree(OUTPUT_DIR)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    course_order = {
        "id": "rwd",
        "title": "Responsive Web Design",
        "type": "category",
        "children": []
    }

    for chapter in structure["chapters"]:
        chapter_name = chapter["dashedName"]
        chapter_type = chapter.get("chapterType", "standard")
        modules = chapter.get("modules", [])

        if chapter_type == "exam":
            print(f"\n[EXAM] {chapter_name}")
            exam_dir = os.path.join(OUTPUT_DIR, chapter_name)
            os.makedirs(exam_dir, exist_ok=True)

            for module in modules:
                for block_name in module["blocks"]:
                    challenges = read_fcc_block(block_name)
                    if challenges:
                        md_content = convert_challenge_to_markdown(challenges[0], block_name, "exam")
                        md_file = os.path.join(exam_dir, f"{block_name}.md")
                        with open(md_file, "w", encoding="utf-8") as f:
                            f.write(md_content)

                        course_order["children"].append({
                            "id": f"rwd/{chapter_name}",
                            "name": f"{block_name}.md",
                            "path": f"Responsive Web Design/{chapter_name}/{block_name}.md",
                            "title": title_from_name(chapter_name),
                            "type": "exam",
                        })
                        print(f"  EXAM: {block_name}")
            continue

        print(f"\n[CHAPTER] {chapter_name}")
        chapter_dir = os.path.join(OUTPUT_DIR, chapter_name)
        os.makedirs(chapter_dir, exist_ok=True)

        chapter_order = {
            "id": f"rwd/{chapter_name}",
            "title": title_from_name(chapter_name),
            "type": "category",
            "children": []
        }

        create_module_structure(chapter_name, modules, chapter_dir)

        for module in modules:
            module_name = module["dashedName"]
            module_dir = os.path.join(chapter_dir, module_name)

            chapter_order["children"].append({
                "id": f"rwd/{chapter_name}/{module_name}",
                "name": module_name,
                "path": f"Responsive Web Design/{chapter_name}/{module_name}",
                "title": title_from_name(module_name),
                "type": "category",
            })

        chapter_order_file = os.path.join(chapter_dir, "_order.yaml")
        with open(chapter_order_file, "w", encoding="utf-8") as f:
            yaml.dump(chapter_order, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

        course_order["children"].append({
            "id": f"rwd/{chapter_name}",
            "name": chapter_name,
            "path": f"Responsive Web Design/{chapter_name}",
            "title": title_from_name(chapter_name),
            "type": "category",
        })

    course_order_file = os.path.join(OUTPUT_DIR, "_order.yaml")
    with open(course_order_file, "w", encoding="utf-8") as f:
        yaml.dump(course_order, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    print(f"\n{'='*60}")
    print(f"DONE! Output: {OUTPUT_DIR}")
    print(f"Course order: {course_order_file}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
