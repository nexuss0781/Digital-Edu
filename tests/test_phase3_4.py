"""
Phase 3+4 Tests — Workshop & Practical Smart Validation

Tests the API endpoint, parser validate field, template loading,
and the full validation flow for both workshop and practical.

Usage:
  python3 test_phase3_4.py
"""

import os
import sys
import json

PASSED = 0
FAILED = 0


def test(name, condition, detail=''):
    global PASSED, FAILED
    if condition:
        PASSED += 1
    else:
        FAILED += 1
        print(f"  ✗ {name}  <-- FAIL")
        if detail:
            print(f"      {detail}")


os.environ['SECRET_KEY'] = 'test-phase3-4'
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import create_app, db as _db
from app.services.validator import get_validator, load_templates, Validator
from app.services.assessment_parser import parse_content

flask_app = create_app()


# ─── Validator loads templates from templates/ ──────────────
print("\n━━━ Template Loading ━━━")

with flask_app.app_context():
    templates_dir = flask_app.config.get('TEMPLATES_DIR', '')
    test('TEMPLATES_DIR configured', bool(templates_dir))

    if templates_dir and os.path.isdir(templates_dir):
        rules = load_templates(templates_dir)
        test('Templates loaded from directory', len(rules) > 0)
        test('html_structure.yaml loaded', 'check_doctype' in rules)
        test('css_rules.yaml loaded', 'check_bg_color' in rules)
        test('general_rules.yaml loaded', 'check_contains_meta' in rules)

        # Check rule structure
        r = rules['check_doctype']
        test('check_doctype has template', r.get('template') == 'contains')
        test('check_doctype has value', '<!DOCTYPE' in r.get('value', ''))
        test('check_doctype has hint', bool(r.get('hint')))

        r2 = rules['check_head_nested']
        test('check_head_nested template', r2.get('template') == 'wrapper')
        test('check_head_nested wrapper', r2.get('wrapper') == 'html')
        test('check_head_nested wrapped', r2.get('wrapped') == 'head')


# ─── Validator resolves rules from templates/ ───────────────
print("\n━━━ Rule Resolution ━━━")

v = get_validator()

with flask_app.app_context():
    # Named rule from templates/
    rule = v.resolve_rule('check_doctype')
    test('resolve_rule: check_doctype found', rule is not None)
    if rule:
        test('resolve_rule: template is contains', rule['template'] == 'contains')

    # Inline rule
    rule2 = v.resolve_rule('tag_exists:head')
    test('resolve_rule: inline tag_exists:head', rule2 is not None)
    if rule2:
        test('resolve_rule: inline tag is head', rule2.get('tag') == 'head')

    # Unknown rule
    rule3 = v.resolve_rule('nonexistent')
    test('resolve_rule: unknown returns None', rule3 is None)


# ─── API endpoint /api/validate ─────────────────────────────
print("\n━━━ API Endpoint ━━━")

with flask_app.app_context():
    from app.models.user import User
    u = User(email='test@test.com', username='testuser', role='student')
    u.set_password('pass')
    _db.session.add(u)
    _db.session.commit()

    client = flask_app.test_client()

    # Login via session
    with client.session_transaction() as sess:
        sess['_user_id'] = str(u.id)
        sess['_fresh'] = True

    # Valid rule that passes
    res = client.post('/api/validate', json={
        'rule': 'check_doctype',
        'code': '<!DOCTYPE html>\n<html></html>',
    })
    data = json.loads(res.data)
    test('API: check_doctype passes', data.get('passed') is True)
    test('API: empty hint on pass', data.get('hint') == '')

    # Valid rule that fails
    res2 = client.post('/api/validate', json={
        'rule': 'check_doctype',
        'code': '<html></html>',
    })
    data2 = json.loads(res2.data)
    test('API: check_doctype fails without DOCTYPE', data2.get('passed') is False)
    test('API: hint on fail', bool(data2.get('hint')))

    # Inline rule
    res3 = client.post('/api/validate', json={
        'rule': 'tag_exists:head',
        'code': '<html><head></head></html>',
    })
    data3 = json.loads(res3.data)
    test('API: inline tag_exists:head passes', data3.get('passed') is True)

    # Missing rule
    res4 = client.post('/api/validate', json={
        'rule': '',
        'code': 'code',
    })
    data4 = json.loads(res4.data)
    test('API: empty rule returns fail', data4.get('passed') is False)

    # No data — send empty JSON
    res5 = client.post('/api/validate', json={})
    data5 = json.loads(res5.data)
    test('API: empty JSON returns fail', data5.get('passed') is False)


# ─── Parser: validate field in workshop steps ───────────────
print("\n━━━ Parser: Workshop validate field ━━━")

ws_new = """<!-- steps
step: 1
explanation: "Add DOCTYPE"
prompt: "Write DOCTYPE"
validate: "check_doctype"

step: 2
explanation: "Add html"
prompt: "Write html tag"
validate: "check_html_tag"
-->"""

result = parse_content('workshop', ws_new)
test('New format parsed', len(result) == 1)
steps = result[0]['steps']
test('Step 1 has validate', steps[0].get('validate') == 'check_doctype')
test('Step 1 no expected', 'expected' not in steps[0])
test('Step 2 has validate', steps[1].get('validate') == 'check_html_tag')

ws_old = """<!-- steps
step: 1
explanation: "Type it"
prompt: "Enter"
expected: "<html>"
-->"""

result2 = parse_content('workshop', ws_old)
test('Old format still works', len(result2) == 1)
steps2 = result2[0]['steps']
test('Step has expected', steps2[0].get('expected') == '<html>')
test('Step no validate', 'validate' not in steps2[0])

ws_mixed = """<!-- steps
step: 1
explanation: "First"
prompt: "Do this"
expected: "old"

step: 2
explanation: "Second"
prompt: "Do that"
validate: "new_rule"
-->"""

result3 = parse_content('workshop', ws_mixed)
test('Mixed format parsed', len(result3) == 1)
steps3 = result3[0]['steps']
test('Step 1 uses expected', steps3[0].get('expected') == 'old')
test('Step 2 uses validate', steps3[1].get('validate') == 'new_rule')


# ─── Parser: Practical validate field ───────────────────────
print("\n━━━ Parser: Practical validate field ━━━")

practical = """<!-- requirements
requirement: "Blue bg"
validate: "check_bg_color"
requirement: "Font 16px"
validate: "check_font_size"
-->"""

result4 = parse_content('practical', practical)
test('Practical parsed', len(result4) == 1)
reqs = result4[0]['requirements']
test('Req 1 validate', reqs[0]['validate'] == 'check_bg_color')
test('Req 2 validate', reqs[1]['validate'] == 'check_font_size')


# ─── Full validation flow ──────────────────────────────────
print("\n━━━ Full Validation Flow ━━━")

with flask_app.app_context():
    # Workshop step-by-step validation
    code1 = '<!DOCTYPE html>'
    passed, hint = v.resolve_and_validate('check_doctype', code1)
    test('Flow: step 1 DOCTYPE passes', passed)

    code2 = '<!DOCTYPE html>\n<html>\n</html>'
    passed, _ = v.resolve_and_validate('check_html_tag', code2)
    test('Flow: step 2 html tag passes', passed)

    passed, _ = v.resolve_and_validate('check_head_nested', code2)
    test('Flow: step 2 head NOT nested yet', not passed)

    code3 = '<!DOCTYPE html>\n<html>\n<head></head>\n</html>'
    passed, _ = v.resolve_and_validate('check_head_nested', code3)
    test('Flow: step 3 head nested', passed)

    code4 = '<!DOCTYPE html>\n<html>\n<head></head>\n<body></body>\n</html>'
    passed, _ = v.resolve_and_validate('check_body_nested', code4)
    test('Flow: step 4 body nested', passed)

    # Practical validation
    css_code = '''<!DOCTYPE html>
<html>
<head>
<style>
body { background-color: #e0f7fa; font-size: 16px; }
h1 { text-align: center; }
</style>
</head>
<body><h1>Hello</h1></body>
</html>'''

    passed, _ = v.resolve_and_validate('check_bg_color', css_code)
    test('Practical: bg color passes', passed)
    passed, _ = v.resolve_and_validate('check_font_size', css_code)
    test('Practical: font size passes', passed)
    passed, _ = v.resolve_and_validate('check_text_align_center', css_code)
    test('Practical: text align passes', passed)
    passed, _ = v.resolve_and_validate('check_head_nested', css_code)
    test('Practical: head nested passes', passed)


# ─── API full flow ──────────────────────────────────────────
print("\n━━━ API Full Flow ━━━")

with flask_app.app_context():
    client = flask_app.test_client()
    with client.session_transaction() as sess:
        sess['_user_id'] = str(u.id)
        sess['_fresh'] = True

    # Check multiple rules via API
    rules_to_check = [
        ('check_doctype', '<!DOCTYPE html>\n<html></html>', True),
        ('check_html_tag', '<html></html>', True),
        ('check_head_tag', '<html><head></head></html>', True),
        ('check_head_nested', '<head></head><html></html>', False),
        ('check_body_nested', '<html><body></body></html>', True),
        ('tag_exists:h1', '<h1>Hello</h1>', True),
        ('tag_exists:h1', '<p>Hello</p>', False),
        ('contains:<!DOCTYPE', '<!DOCTYPE html>', True),
    ]

    for rule, code, expected_pass in rules_to_check:
        res = client.post('/api/validate', json={'rule': rule, 'code': code})
        data = json.loads(res.data)
        test(f'API flow: {rule} {"passes" if expected_pass else "fails"}',
             data['passed'] == expected_pass)


# ─── Backward compatibility ─────────────────────────────────
print("\n━━━ Backward Compatibility ━━━")

# Old workshop with expected field still parses
old_ws = """<!-- steps
step: 1
explanation: "Do it"
prompt: "Type this"
expected: "hello world"
-->"""
r = parse_content('workshop', old_ws)
test('Backward compat: old workshop parses', len(r) == 1)
test('Backward compat: expected field preserved', r[0]['steps'][0].get('expected') == 'hello world')

# Legacy exact match via validator
passed, _ = v.validate({'template': 'legacy_exact', 'expected': 'hello world'}, 'hello world')
test('Backward compat: legacy_exact passes', passed)
passed, _ = v.validate({'template': 'legacy_exact', 'expected': 'hello world'}, 'wrong')
test('Backward compat: legacy_exact fails', not passed)


# ─── Summary ───────────────────────────────────────────────
print(f"\n{'='*50}")
print(f"PHASE 3+4 TESTS: {PASSED} passed, {FAILED} failed")
print(f"{'='*50}")
sys.exit(0 if FAILED == 0 else 1)
