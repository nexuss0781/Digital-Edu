"""
Validator Phase 1 Tests — Global Validation Library

Tests all template functions, HTML tree parsing, CSS extraction,
inline rule parsing, and backward compatibility.

Usage:
  python3 test_validator.py
"""

import os
import sys
import tempfile

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


os.environ['SECRET_KEY'] = 'test-secret'
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app.services.validator import (
    Validator, HTMLTreeBuilder, HTMLNode, build_html_tree,
    extract_css_properties, validate_rule, validate_string,
)

v = Validator()


# ─── HTMLTreeBuilder ────────────────────────────────────────
print("\n━━━ HTMLTreeBuilder ─━━")

html = '<html><head><title>Hi</title></head><body><p class="intro">Hello</p><br></body></html>'
tree = build_html_tree(html)

test('Tree root exists', tree is not None)
test('Finds html tag', len(tree.find('html')) == 1)
test('Finds head inside html', len(tree.find('head')) == 1)
test('Finds body', len(tree.find('body')) == 1)
test('Finds p tag', len(tree.find('p')) == 1)
test('Finds title', len(tree.find('title')) == 1)
test('Br is self-closing (no children)', len(tree.find('br')) == 1)

p_tags = tree.find('p')
if p_tags:
    test('P has class intro', p_tags[0].has_class('intro'))
    test('P has text', p_tags[0].has_text())
    test('P text is Hello', p_tags[0].text.strip() == 'Hello')

title_tags = tree.find('title')
if title_tags:
    test('Title has text', title_tags[0].text.strip() == 'Hi')

test('Nonexistent tag returns empty', len(tree.find('div')) == 0)


# ─── find_all ──────────────────────────────────────────────
print("\n━━━ find_all ─━━")

all_nodes = tree.find_all()
tags = [n.tag for n in all_nodes]
test('find_all returns multiple', len(all_nodes) > 3)
test('find_all includes root', 'root' in tags)
test('find_all includes html', 'html' in tags)


# ─── Nested structure ──────────────────────────────────────
print("\n━━━ Nested structure ─━━")

nested_html = '<div><ul><li>A</li><li>B</li></ul></div>'
ntree = build_html_tree(nested_html)
divs = ntree.find('div')
if divs:
    uls = divs[0].find('ul')
    test('UL inside DIV', len(uls) == 1)
    if uls:
        lis = uls[0].find('li')
        test('2 LIs inside UL', len(lis) == 2)
else:
    test('DIV exists for nesting test', False)

# Test nested check: child inside wrong parent
wrong_parent_html = '<div><p>Hello</p></div><section><span>World</span></section>'
wtree = build_html_tree(wrong_parent_html)
sections = wtree.find('section')
span_in_section = False
for s in sections:
    if s.find('span'):
        span_in_section = True
test('SPAN inside SECTION', span_in_section)
divs = wtree.find('div')
span_in_div = False
for d in divs:
    if d.find('span'):
        span_in_div = True
test('SPAN NOT inside DIV', not span_in_div)


# ─── Self-closing tags ─────────────────────────────────────
print("\n━━━ Self-closing tags ─━━")

sc_html = '<div>Text<br>More<hr>End</div>'
sc_tree = build_html_tree(sc_html)
brs = sc_tree.find('br')
test('BR found', len(brs) == 1)
hrs = sc_tree.find('hr')
test('HR found', len(hrs) == 1)
divs = sc_tree.find('div')
if divs:
    # BR and HR should NOT be children of div in the stack sense
    # (they are self-closing, so they don't push to stack)
    test('DIV has text content', bool(divs[0].text))


# ─── Malformed HTML ────────────────────────────────────────
print("\n━━━ Malformed HTML ─━━")

malformed = '<div><p>Unclosed<p>Another</div>'
mtree = build_html_tree(malformed)
ps = mtree.find('p')
test('Handles unclosed P tags', len(ps) >= 1)


# ─── extract_css_properties ─────────────────────────────────
print("\n━━━ extract_css_properties ─━━")

css1 = '<style>body { color: red; font-size: 16px; }</style>'
props = extract_css_properties(css1)
test('Extracts color from style block', props.get('color') == 'red')
test('Extracts font-size from style block', props.get('font-size') == '16px')

css2 = '<div style="background: blue; margin: 10px;">'
props2 = extract_css_properties(css2)
test('Extracts from inline style', props2.get('background') == 'blue')
test('Extracts margin from inline', props2.get('margin') == '10px')

css3 = "<div style='text-align: center;'>"
props3 = extract_css_properties(css3)
test('Extracts from single-quote style', props3.get('text-align') == 'center')

css4 = '<p>No styles here</p>'
props4 = extract_css_properties(css4)
test('No styles returns empty', len(props4) == 0)

css5 = '<style>.cls { color: green; }</style><div style="width: 100%;">'
props5 = extract_css_properties(css5)
test('Multiple sources merged', 'color' in props5 and 'width' in props5)


# ─── Template: tag_exists ───────────────────────────────────
print("\n━━━ Template: tag_exists ─━━")

code1 = '<!DOCTYPE html>\n<html>\n<head></head>\n<body></body>\n</html>'
passed, hint = v.validate({'template': 'tag_exists', 'tag': 'html'}, code1)
test('tag_exists:html passes', passed)
test('tag_exists:html hint empty', hint == '')

passed, _ = v.validate({'template': 'tag_exists', 'tag': 'html'}, '<p>Hello</p>')
test('tag_exists:html fails on p-only', not passed)

passed, _ = v.validate({'template': 'tag_exists', 'tag': 'head'}, code1)
test('tag_exists:head passes', passed)

passed, _ = v.validate({'template': 'tag_exists', 'tag': 'video'}, code1)
test('tag_exists:video fails', not passed)


# ─── Template: tag_has_closing ──────────────────────────────
print("\n━━━ Template: tag_has_closing ─━━")

code2 = '<div>Hello</div>'
passed, _ = v.validate({'template': 'tag_has_closing', 'tag': 'div'}, code2)
test('tag_has_closing:div passes', passed)

code3 = '<div>Hello'
passed, _ = v.validate({'template': 'tag_has_closing', 'tag': 'div'}, code3)
test('tag_has_closing:div fails without closing', not passed)

code4 = '<br>'
passed, _ = v.validate({'template': 'tag_has_closing', 'tag': 'br'}, code4)
test('tag_has_closing:br fails (self-closing)', not passed)

code5 = '<p>Text</p><p>More</p>'
passed, _ = v.validate({'template': 'tag_has_closing', 'tag': 'p'}, code5)
test('tag_has_closing:p passes with 2 paragraphs', passed)


# ─── Template: tag_nested ──────────────────────────────────
print("\n━━━ Template: tag_nested ─━━")

code6 = '<html><head><title>Hi</title></head></html>'
passed, _ = v.validate({'template': 'tag_nested', 'parent': 'html', 'child': 'head'}, code6)
test('tag_nested:html:head passes', passed)

passed, _ = v.validate({'template': 'tag_nested', 'parent': 'html', 'child': 'body'}, code6)
test('tag_nested:html:body fails (no body)', not passed)

passed, _ = v.validate({'template': 'tag_nested', 'parent': 'head', 'child': 'title'}, code6)
test('tag_nested:head:title passes', passed)

code7 = '<head><title>Hi</title></head><body></body>'
passed, _ = v.validate({'template': 'tag_nested', 'parent': 'html', 'child': 'head'}, code7)
test('tag_nested:html:head fails (head outside html)', not passed)


# ─── Template: tag_has_attribute ────────────────────────────
print("\n━━━ Template: tag_has_attribute ─━━")

code8 = '<a href="https://example.com">Link</a>'
passed, _ = v.validate({'template': 'tag_has_attribute', 'tag': 'a', 'attr': 'href'}, code8)
test('tag_has_attribute:a:href passes', passed)

passed, _ = v.validate({'template': 'tag_has_attribute', 'tag': 'a', 'attr': 'src'}, code8)
test('tag_has_attribute:a:src fails', not passed)

code9 = '<img src="pic.jpg" alt="Photo">'
passed, _ = v.validate({'template': 'tag_has_attribute', 'tag': 'img', 'attr': 'alt'}, code9)
test('tag_has_attribute:img:alt passes', passed)


# ─── Template: tag_has_text ─────────────────────────────────
print("\n━━━ Template: tag_has_text ─━━")

code10 = '<p>Hello World</p>'
passed, _ = v.validate({'template': 'tag_has_text', 'tag': 'p'}, code10)
test('tag_has_text:p passes', passed)

code11 = '<p></p>'
passed, _ = v.validate({'template': 'tag_has_text', 'tag': 'p'}, code11)
test('tag_has_text:p fails on empty', not passed)

code12 = '<p>   </p>'
passed, _ = v.validate({'template': 'tag_has_text', 'tag': 'p'}, code12)
test('tag_has_text:p fails on whitespace only', not passed)


# ─── Template: tag_has_class ────────────────────────────────
print("\n━━━ Template: tag_has_class ─━━")

code13 = '<div class="container main">Content</div>'
passed, _ = v.validate({'template': 'tag_has_class', 'tag': 'div', 'class_name': 'container'}, code13)
test('tag_has_class:div:container passes', passed)

passed, _ = v.validate({'template': 'tag_has_class', 'tag': 'div', 'class_name': 'main'}, code13)
test('tag_has_class:div:main passes', passed)

passed, _ = v.validate({'template': 'tag_has_class', 'tag': 'div', 'class_name': 'hidden'}, code13)
test('tag_has_class:div:hidden fails', not passed)


# ─── Template: tag_has_id ──────────────────────────────────
print("\n━━━ Template: tag_has_id ─━━")

code14 = '<div id="main">Content</div>'
passed, _ = v.validate({'template': 'tag_has_id', 'id_name': 'main'}, code14)
test('tag_has_id:main passes', passed)

passed, _ = v.validate({'template': 'tag_has_id', 'id_name': 'sidebar'}, code14)
test('tag_has_id:sidebar fails', not passed)

code15 = '<header id="top">Hi</header><footer id="bottom">Bye</footer>'
passed, _ = v.validate({'template': 'tag_has_id', 'id_name': 'top'}, code15)
test('tag_has_id:top passes', passed)
passed, _ = v.validate({'template': 'tag_has_id', 'id_name': 'bottom'}, code15)
test('tag_has_id:bottom passes', passed)


# ─── Template: css_property ─────────────────────────────────
print("\n━━━ Template: css_property ─━━")

code16 = '<style>body { color: red; font-size: 16px; }</style>'
passed, _ = v.validate({'template': 'css_property', 'property': 'color', 'value': 'red'}, code16)
test('css_property:color:red passes', passed)

passed, _ = v.validate({'template': 'css_property', 'property': 'font-size', 'value': '16px'}, code16)
test('css_property:font-size:16px passes', passed)

passed, _ = v.validate({'template': 'css_property', 'property': 'color', 'value': 'blue'}, code16)
test('css_property:color:blue fails', not passed)

code17 = '<div style="text-align: center;">Hi</div>'
passed, _ = v.validate({'template': 'css_property', 'property': 'text-align', 'value': 'center'}, code17)
test('css_property:text-align:center passes (inline)', passed)

code18 = '<style>.cls { background-color: #e0f7fa; }</style>'
passed, _ = v.validate({'template': 'css_property', 'property': 'background-color', 'value': '#e0f7fa'}, code18)
test('css_property with hex value passes', passed)


# ─── Template: contains ────────────────────────────────────
print("\n━━━ Template: contains ─━━")

code19 = '<!DOCTYPE html>\n<html></html>'
passed, _ = v.validate({'template': 'contains', 'value': '<!DOCTYPE html>'}, code19)
test('contains:DOCTYPE passes', passed)

passed, _ = v.validate({'template': 'contains', 'value': 'Python'}, code19)
test('contains:Python fails', not passed)


# ─── Template: regex ───────────────────────────────────────
print("\n━━━ Template: regex ─━━")

code20 = '<img src="photo.jpg" />'
passed, _ = v.validate({'template': 'regex', 'pattern': r'<br\s*/?>'}, '<br>')
test('regex:br self-closing passes', passed)

passed, _ = v.validate({'template': 'regex', 'pattern': r'<img[^>]+>'}, code20)
test('regex:img tag passes', passed)

passed, _ = v.validate({'template': 'regex', 'pattern': r'<video[^>]+>'}, code20)
test('regex:video tag fails', not passed)

# Invalid regex
passed, _ = v.validate({'template': 'regex', 'pattern': '[invalid'}, 'test')
test('invalid regex returns False', not passed)


# ─── Template: line_count_min ──────────────────────────────
print("\n━━━ Template: line_count_min ─━━")

code21 = 'line1\nline2\nline3'
passed, _ = v.validate({'template': 'line_count_min', 'count': '3'}, code21)
test('line_count_min:3 passes on 3 lines', passed)

passed, _ = v.validate({'template': 'line_count_min', 'count': '5'}, code21)
test('line_count_min:5 fails on 3 lines', not passed)

passed, _ = v.validate({'template': 'line_count_min', 'count': '0'}, code21)
test('line_count_min:0 always passes', passed)

# Non-numeric count
passed, _ = v.validate({'template': 'line_count_min', 'count': 'abc'}, code21)
test('non-numeric count returns False', not passed)


# ─── Template: legacy_exact ────────────────────────────────
print("\n━━━ Template: legacy_exact ─━━")

passed, _ = v.validate({'template': 'legacy_exact', 'expected': 'hello'}, 'hello')
test('legacy_exact passes on match', passed)

passed, _ = v.validate({'template': 'legacy_exact', 'expected': 'hello'}, ' hello ')
test('legacy_exact passes with whitespace', passed)

passed, _ = v.validate({'template': 'legacy_exact', 'expected': 'hello'}, 'world')
test('legacy_exact fails on mismatch', not passed)


# ─── Unknown template ──────────────────────────────────────
print("\n━━━ Unknown template ─━━")

passed, hint = v.validate({'template': 'nonexistent'}, 'code')
test('unknown template fails', not passed)
test('unknown template hint', 'Unknown template' in hint)


# ─── Hint on failure ───────────────────────────────────────
print("\n━━━ Hint on failure ─━━")

rule_with_hint = {
    'template': 'tag_exists',
    'tag': 'head',
    'hint': 'Add <head> and </head> tags',
}
passed, hint = v.validate(rule_with_hint, '<html></html>')
test('fails with hint', not passed and hint == 'Add <head> and </head> tags')

passed, hint = v.validate(rule_with_hint, '<html><head></head></html>')
test('passes returns empty hint', passed and hint == '')


# ─── Inline rule parsing ───────────────────────────────────
print("\n━━━ Inline rule parsing ─━━")

# These need Flask app context for content_id, but we test the parsing directly
rule = v._parse_inline_rule('tag_exists:head')
test('inline tag_exists:head parsed', rule is not None)
test('inline template is tag_exists', rule.get('template') == 'tag_exists')
test('inline tag is head', rule.get('tag') == 'head')

rule2 = v._parse_inline_rule('tag_nested:html:body')
test('inline tag_nested:html:body parsed', rule2 is not None)
test('inline parent is html', rule2.get('parent') == 'html')
test('inline child is body', rule2.get('child') == 'body')

rule3 = v._parse_inline_rule('css_property:color:red')
test('inline css_property:color:red parsed', rule3 is not None)
test('inline property is color', rule3.get('property') == 'color')
test('inline value is red', rule3.get('value') == 'red')

rule4 = v._parse_inline_rule('contains:<!DOCTYPE')
test('inline contains parsed', rule4 is not None)
test('inline value is <!DOCTYPE', rule4.get('value') == '<!DOCTYPE')

rule5 = v._parse_inline_rule('legacy_exact:<html>')
test('inline legacy_exact parsed', rule5 is not None)
test('inline expected is <html>', rule5.get('expected') == '<html>')

rule6 = v._parse_inline_rule('unknown_template:param')
test('inline unknown template returns None', rule6 is None)


# ─── resolve_and_validate (inline) ─────────────────────────
print("\n━━━ resolve_and_validate (inline) ─━━")

passed, hint = v.resolve_and_validate('tag_exists:head', '<html><head></head></html>')
test('resolve_and_validate inline tag_exists passes', passed)

passed, hint = v.resolve_and_validate('tag_exists:head', '<html></html>')
test('resolve_and_validate inline tag_exists fails', not passed)

passed, hint = v.resolve_and_validate('contains:Hello', 'Hello World')
test('resolve_and_validate inline contains passes', passed)

passed, hint = v.resolve_and_validate('nonexistent:rule', 'code')
test('resolve_and_validate unknown rule fails', not passed)


# ─── Module-level convenience functions ─────────────────────
print("\n━━━ Module-level convenience functions ─━━")

passed, hint = validate_rule({'template': 'tag_exists', 'tag': 'div'}, '<div></div>')
test('validate_rule works', passed)

passed, hint = validate_string('tag_exists:div', '<div></div>')
test('validate_string works', passed)


# ─── Complex real-world scenarios ───────────────────────────
print("\n━━━ Complex real-world scenarios ─━━")

# Full HTML document building step by step
step1_code = '<!DOCTYPE html>'
passed, _ = v.validate({'template': 'contains', 'value': '<!DOCTYPE html>'}, step1_code)
test('Step 1: DOCTYPE check', passed)

step2_code = '<!DOCTYPE html>\n<html>\n</html>'
passed, _ = v.validate({'template': 'tag_exists', 'tag': 'html'}, step2_code)
test('Step 2: html tag check', passed)
passed, _ = v.validate({'template': 'tag_nested', 'parent': 'html', 'child': 'head'}, step2_code)
test('Step 2: head NOT nested yet', not passed)

step3_code = '<!DOCTYPE html>\n<html>\n<head></head>\n</html>'
passed, _ = v.validate({'template': 'tag_nested', 'parent': 'html', 'child': 'head'}, step3_code)
test('Step 3: head nested in html', passed)

step4_code = '<!DOCTYPE html>\n<html>\n<head></head>\n<body></body>\n</html>'
passed, _ = v.validate({'template': 'tag_nested', 'parent': 'html', 'child': 'body'}, step4_code)
test('Step 4: body nested in html', passed)

step5_code = '<!DOCTYPE html>\n<html>\n<head></head>\n<body>\n<h1>Hello</h1>\n</body>\n</html>'
passed, _ = v.validate({'template': 'tag_has_text', 'tag': 'h1'}, step5_code)
test('Step 5: h1 has text', passed)
passed, _ = v.validate({'template': 'tag_nested', 'parent': 'body', 'child': 'h1'}, step5_code)
test('Step 5: h1 nested in body', passed)

# CSS practical scenario
css_code = '''<!DOCTYPE html>
<html>
<head>
<style>
body {
    background-color: #e0f7fa;
    font-size: 16px;
}
h1 {
    text-align: center;
    color: #046D8B;
}
</style>
</head>
<body>
<h1>Hello World</h1>
</body>
</html>'''

passed, _ = v.validate({'template': 'css_property', 'property': 'background-color', 'value': '#e0f7fa'}, css_code)
test('CSS practical: bg color', passed)
passed, _ = v.validate({'template': 'css_property', 'property': 'font-size', 'value': '16px'}, css_code)
test('CSS practical: font size', passed)
passed, _ = v.validate({'template': 'css_property', 'property': 'text-align', 'value': 'center'}, css_code)
test('CSS practical: text align', passed)
passed, _ = v.validate({'template': 'css_property', 'property': 'color', 'value': '#046D8B'}, css_code)
test('CSS practical: heading color', passed)
passed, _ = v.validate({'template': 'tag_nested', 'parent': 'html', 'child': 'head'}, css_code)
test('CSS practical: head in html', passed)
passed, _ = v.validate({'template': 'tag_nested', 'parent': 'html', 'child': 'body'}, css_code)
test('CSS practical: body in html', passed)

# Attribute checking
attr_code = '<a href="https://example.com" target="_blank">Link</a>'
passed, _ = v.validate({'template': 'tag_has_attribute', 'tag': 'a', 'attr': 'href'}, attr_code)
test('Attribute: href exists', passed)
passed, _ = v.validate({'template': 'tag_has_attribute', 'tag': 'a', 'attr': 'target'}, attr_code)
test('Attribute: target exists', passed)
passed, _ = v.validate({'template': 'tag_has_attribute', 'tag': 'a', 'attr': 'download'}, attr_code)
test('Attribute: download missing', not passed)

# Class checking
class_code = '<div class="card active"><p class="title">Hi</p></div>'
passed, _ = v.validate({'template': 'tag_has_class', 'tag': 'div', 'class_name': 'card'}, class_code)
test('Class: div.card exists', passed)
passed, _ = v.validate({'template': 'tag_has_class', 'tag': 'div', 'class_name': 'active'}, class_code)
test('Class: div.active exists', passed)
passed, _ = v.validate({'template': 'tag_has_class', 'tag': 'p', 'class_name': 'title'}, class_code)
test('Class: p.title exists', passed)
passed, _ = v.validate({'template': 'tag_has_class', 'tag': 'p', 'class_name': 'card'}, class_code)
test('Class: p.card missing', not passed)

# ID checking
id_code = '<div id="app"><header id="nav">Nav</header></div>'
passed, _ = v.validate({'template': 'tag_has_id', 'id_name': 'app'}, id_code)
test('ID: #app exists', passed)
passed, _ = v.validate({'template': 'tag_has_id', 'id_name': 'nav'}, id_code)
test('ID: #nav exists', passed)
passed, _ = v.validate({'template': 'tag_has_id', 'id_name': 'footer'}, id_code)
test('ID: #footer missing', not passed)


# ═══════════════════════════════════════════════════════════════
# Phase 2: YAML Template Loading
# ═══════════════════════════════════════════════════════════════
print("\n━━━ Phase 2: YAML Template Loading ━━━")

from app.services.validator import load_templates

# Create a temp templates directory with YAML files
with tempfile.TemporaryDirectory() as tmpdir:
    # Write a test YAML file
    yaml_content = """
check_test_tag:
  template: tag_exists
  tag: test
  hint: "Add a <test> element"

check_test_class:
  template: tag_has_class
  tag: div
  class_name: test-class
  hint: "Add class test-class to div"
"""
    with open(os.path.join(tmpdir, 'test_rules.yaml'), 'w') as f:
        f.write(yaml_content)

    rules = load_templates(tmpdir)
    test('load_templates loads rules', len(rules) >= 2)
    test('check_test_tag rule loaded', 'check_test_tag' in rules)
    test('check_test_tag template', rules['check_test_tag']['template'] == 'tag_exists')
    test('check_test_tag tag', rules['check_test_tag']['tag'] == 'test')
    test('check_test_tag hint', rules['check_test_tag']['hint'] == 'Add a <test> element')
    test('check_test_class rule loaded', 'check_test_class' in rules)

    # Test validation with loaded rules
    passed, hint = v.validate(rules['check_test_tag'], '<test></test>')
    test('YAML rule: tag_exists passes', passed)
    passed, hint = v.validate(rules['check_test_tag'], '<div></div>')
    test('YAML rule: tag_exists fails', not passed)
    test('YAML rule: hint on fail', hint == 'Add a <test> element')

    # Multiple YAML files merged
    yaml2 = """
check_from_file2:
  template: contains
  value: "hello"
"""
    with open(os.path.join(tmpdir, 'more_rules.yaml'), 'w') as f:
        f.write(yaml2)
    rules2 = load_templates(tmpdir)
    test('Multiple YAML files merged', 'check_from_file2' in rules2)
    test('Original rules still present', 'check_test_tag' in rules2)

# Empty/missing directory
rules_empty = load_templates('/nonexistent/path')
test('Missing directory returns empty', len(rules_empty) == 0)

rules_none = load_templates(None)
test('None directory returns empty', len(rules_none) == 0)


# ═══════════════════════════════════════════════════════════════
# Phase 2: Parser Updates — validate field
# ═══════════════════════════════════════════════════════════════
print("\n━━━ Phase 2: Parser Updates ━━━")

from app.services.assessment_parser import parse_content

# New format with validate field
ws_validate = """<!-- steps
step: 1
explanation: "Add DOCTYPE"
prompt: "Write the DOCTYPE declaration"
validate: "check_doctype"

step: 2
explanation: "Add html tag"
prompt: "Write the html element"
validate: "check_html_tag"
-->"""

result = parse_content('workshop', ws_validate)
test('Workshop with validate parsed', len(result) == 1)
if result:
    steps = result[0]['steps']
    test('2 steps parsed', len(steps) == 2)
    test('Step 1 has validate', steps[0].get('validate') == 'check_doctype')
    test('Step 1 no expected', 'expected' not in steps[0])
    test('Step 2 has validate', steps[1].get('validate') == 'check_html_tag')
    test('Step 2 no expected', 'expected' not in steps[1])

# Old format with expected field (backward compat)
ws_expected = """<!-- steps
step: 1
explanation: "Type this"
prompt: "Enter command"
expected: "<html>"

step: 2
explanation: "Type this too"
prompt: "Enter another"
expected: "</html>"
-->"""

result2 = parse_content('workshop', ws_expected)
test('Workshop with expected parsed (backward compat)', len(result2) == 1)
if result2:
    steps2 = result2[0]['steps']
    test('Step 1 has expected', steps2[0].get('expected') == '<html>')
    test('Step 1 no validate', 'validate' not in steps2[0])
    test('Step 2 has expected', steps2[1].get('expected') == '</html>')

# Mixed format (some validate, some expected)
ws_mixed = """<!-- steps
step: 1
explanation: "First step"
prompt: "Do something"
expected: "old way"

step: 2
explanation: "Second step"
prompt: "Do something else"
validate: "check_new_way"
-->"""

result3 = parse_content('workshop', ws_mixed)
test('Mixed workshop parsed', len(result3) == 1)
if result3:
    steps3 = result3[0]['steps']
    test('Step 1 uses expected', steps3[0].get('expected') == 'old way')
    test('Step 2 uses validate', steps3[1].get('validate') == 'check_new_way')

# Practical still works
req_body2 = """<!-- requirements
requirement: "Blue background"
validate: "check_bg_color"
requirement: "Font 16px"
validate: "check_font_size"
-->"""
result4 = parse_content('practical', req_body2)
test('Practical validate field still works', len(result4) == 1)
if result4:
    reqs = result4[0]['requirements']
    test('Requirement 1 validate', reqs[0]['validate'] == 'check_bg_color')
    test('Requirement 2 validate', reqs[1]['validate'] == 'check_font_size')


# ═══════════════════════════════════════════════════════════════
# Phase 2: resolve_and_validate with templates/
# ═══════════════════════════════════════════════════════════════
print("\n━━━ Phase 2: resolve_and_validate with templates/ ━━━")

# Test that resolve_and_validate works with template rules
# (requires Flask app context for templates/ dir)
os.environ['SECRET_KEY'] = 'test-secret'
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import create_app
flask_app = create_app()

with flask_app.app_context():
    # The templates/ dir should have html_structure.yaml
    templates_dir = flask_app.config.get('TEMPLATES_DIR', '')
    test('TEMPLATES_DIR configured', bool(templates_dir))

    if templates_dir and os.path.isdir(templates_dir):
        # Test resolve_rule with template name
        rule = v.resolve_rule('check_doctype')
        test('resolve_rule finds check_doctype', rule is not None)
        if rule:
            test('check_doctype template is contains', rule['template'] == 'contains')
            test('check_doctype value is DOCTYPE', '<!DOCTYPE' in rule.get('value', ''))

        # Test resolve_and_validate
        passed, hint = v.resolve_and_validate('check_doctype', '<!DOCTYPE html>\n<html></html>')
        test('resolve_and_validate: check_doctype passes', passed)

        passed, hint = v.resolve_and_validate('check_doctype', '<html></html>')
        test('resolve_and_validate: check_doctype fails without DOCTYPE', not passed)

        passed, hint = v.resolve_and_validate('check_head_tag', '<html><head></head></html>')
        test('resolve_and_validate: check_head_tag passes', passed)

        passed, hint = v.resolve_and_validate('check_head_in_html', '<html><head></head></html>')
        test('resolve_and_validate: check_head_in_html passes', passed)

        passed, hint = v.resolve_and_validate('check_head_in_html', '<head></head><html></html>')
        test('resolve_and_validate: check_head_in_html fails outside html', not passed)

        # Test CSS rules
        css_code = '<style>body { color: red; }</style>'
        passed, hint = v.resolve_and_validate('check_color_red', css_code)
        test('resolve_and_validate: check_color_red passes', passed)

        # Test non-existent rule
        passed, hint = v.resolve_and_validate('nonexistent_rule', 'code')
        test('resolve_and_validate: nonexistent returns fail', not passed)


# ─── Summary ───────────────────────────────────────────────
print(f"\n{'='*50}")
print(f"VALIDATOR TESTS: {PASSED} passed, {FAILED} failed")
print(f"{'='*50}")
sys.exit(0 if FAILED == 0 else 1)
