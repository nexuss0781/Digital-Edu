"""
Phase 2 — Assessment Engine Verification (v3: bullet format, type normalization, min_errors)

Tests:
  1. Parse bullet-format questions (* question, - options, Answer: letter)
  2. Content type normalization (case, plural)
  3. min_errors pass logic
  4. threshold fallback when min_errors absent
  5. Workshop steps
  6. Practical requirements
  7. Notes with embedded questions
"""

import os
import sys

TESTS_PASSED = 0
TESTS_FAILED = 0

def test(name, condition, detail=''):
    global TESTS_PASSED, TESTS_FAILED
    if condition:
        TESTS_PASSED += 1
        print(f"  \u2713 {name}")
    else:
        TESTS_FAILED += 1
        print(f"  \u2717 {name}  <-- FAIL")
        if detail:
            print(f"      {detail}")

def assert_eq(name, got, expected):
    test(name, got == expected, f"expected {expected!r}, got {got!r}")

os.environ['SECRET_KEY'] = 'test-secret'
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app.services.assessment_parser import (
    parse_content, get_assessment_mode, get_per_page, get_min_errors, normalize_type
)

BULLET_QUESTIONS = """<!-- questions
* What is 2+2?
- 3
- 4
- 5
- 6
Answer: B

* What color is the sky?
- Red
- Blue
- Green
- Yellow
Answer: B
-->
"""

print("\n[1] Bullet-format Questions")
result = parse_content('quiz', BULLET_QUESTIONS)
test('Quiz parsed', len(result) == 1)
if result:
    qs = result[0]['questions']
    test('2 questions parsed', len(qs) == 2)
    if len(qs) >= 2:
        assert_eq('Q1 text', qs[0]['question'], 'What is 2+2?')
        assert_eq('Q1 options', qs[0]['options'], ['3', '4', '5', '6'])
        assert_eq('Q1 answer B', qs[0]['answer'], 'B')
        assert_eq('Q2 answer B', qs[1]['answer'], 'B')

print("\n[2] Type Normalization")
assert_eq('quiz', normalize_type('quiz'), 'quiz')
assert_eq('Quiz', normalize_type('Quiz'), 'quiz')
assert_eq('QUIZ', normalize_type('QUIZ'), 'quiz')
assert_eq('quizes', normalize_type('quizes'), 'quiz')
assert_eq('quizzes', normalize_type('quizzes'), 'quiz')

assert_eq('test', normalize_type('test'), 'test')
assert_eq('Test', normalize_type('Test'), 'test')
assert_eq('tests', normalize_type('tests'), 'test')
assert_eq('Tests', normalize_type('Tests'), 'test')
assert_eq('TEST', normalize_type('TEST'), 'test')

assert_eq('exam', normalize_type('exam'), 'exam')
assert_eq('exams', normalize_type('exams'), 'exam')
assert_eq('Exam', normalize_type('Exam'), 'exam')

assert_eq('note', normalize_type('note'), 'note')
assert_eq('notes', normalize_type('notes'), 'note')

assert_eq('workshop', normalize_type('workshops'), 'workshop')
assert_eq('practical', normalize_type('practicals'), 'practical')
assert_eq('project', normalize_type('projects'), 'project')

assert_eq('unknown', normalize_type('unknown'), 'unknown')
assert_eq('empty string to note', normalize_type(''), 'note')
assert_eq('None to note', normalize_type(None), 'note')

print("\n[3] min_errors Pass Logic")
assert_eq('min_errors from meta', get_min_errors({'min_errors': 4}), 4)
assert_eq('min_errors zero default', get_min_errors({}), 0)
assert_eq('min_errors string', get_min_errors({'min_errors': '3'}), 3)

print("\n[4] Test with min_errors")
result = parse_content('Test', BULLET_QUESTIONS)
test('Tests type normalized to test', len(result) == 1 and result[0]['type'] == 'test')
if result:
    test('2 test questions', len(result[0]['questions']) == 2)

print("\n[5] Exam (type: exams)")
result = parse_content('exams', BULLET_QUESTIONS)
test('Exams type normalized to exam', len(result) == 1 and result[0]['type'] == 'exam')

print("\n[6] Workshop steps")
ws = """<!-- steps
step: 1
explanation: "First"
prompt: "<html>"
expected: "<html>"
-->"""
result = parse_content('Workshops', ws)
test('Workshops type normalized', len(result) == 1 and result[0]['type'] == 'workshop')

print("\n[7] Practical requirements")
req = """<!-- requirements
requirement: "Bg blue"
validate: "code.includes('blue')"
-->"""
result = parse_content('practicals', req)
test('Practicals type normalized', result and result[0]['type'] == 'requirements')

print("\n[8] Notes with embedded questions")
result = parse_content('note', BULLET_QUESTIONS)
test('Note returns quiz', len(result) > 0 and result[0]['type'] == 'quiz')
test('2 questions extracted', len(result[0]['questions']) == 2)

print("\n[9] Mode & Per-Page")
assert_eq('Quiz mode', get_assessment_mode('quiz'), 'quiz')
assert_eq('Test mode', get_assessment_mode('tests'), 'test')
assert_eq('Exams mode', get_assessment_mode('Exams'), 'exam')
assert_eq('Note mode None', get_assessment_mode('note'), None)
assert_eq('Quiz per_page 1', get_per_page('quiz'), 1)
assert_eq('Test per_page 5', get_per_page('test'), 5)
assert_eq('Exam per_page 10', get_per_page('exam'), 10)

print("\n[10] Edge: empty body")
test('Empty quiz', len(parse_content('quiz', '')[0]['questions']) == 0)
test('Empty note', len(parse_content('note', '')) == 0)
test('Unknown type', len(parse_content('foo', 'anything')) == 0)

print("\n" + "=" * 50)
print(f"RESULTS:  {TESTS_PASSED} passed, {TESTS_FAILED} failed")
print("=" * 50)
sys.exit(0 if TESTS_FAILED == 0 else 1)
