#!/usr/bin/env python3
"""Normalize scripts/workshop_groups.json:
- step ids: 'rwd/<block>/<hex>' -> bare '<hex>' (matches restored fCC front matter)
- group titles: real fCC block titles from fCC clone intro.json
- drop the 'test' artifact group (duplicate parent_id, 1 step)
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GROUPS_PATH = os.path.join(ROOT, 'scripts', 'workshop_groups.json')
INTRO_PATH = os.path.join(os.path.expanduser('~/Downloads/FCC/freeCodeCamp'),
                          'client', 'i18n', 'locales', 'english', 'intro.json')


def load_intro_titles():
    if not os.path.exists(INTRO_PATH):
        print(f'warning: {INTRO_PATH} not found, keeping existing titles')
        return None
    with open(INTRO_PATH, encoding='utf-8') as f:
        data = json.load(f)
    blocks = data['responsive-web-design-v9']['blocks']
    return {k: v['title'] for k, v in blocks.items()}


def main():
    with open(GROUPS_PATH, encoding='utf-8') as f:
        data = json.load(f)
    titles = load_intro_titles()

    groups = data['workshop_groups']
    kept = []
    for g in groups:
        if g['directory_path'] == 'test':
            print(f"dropping test artifact group: {g['parent_id']} ({g['step_count']} step)")
            continue
        short = g['parent_id'].split('/')[-1]
        if titles and short in titles:
            g['title'] = titles[short]
        for s in g['steps']:
            s['id'] = s['id'].split('/')[-1]
        kept.append(g)

    data['workshop_groups'] = kept
    with open(GROUPS_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')

    print(f'done: {len(kept)} groups written to {GROUPS_PATH}')
    for g in kept:
        sample = g['steps'][0]['id']
        assert '/' not in sample, f"step id not normalized: {sample}"
    print('all step ids are bare hex (no /) OK')


if __name__ == '__main__':
    main()
