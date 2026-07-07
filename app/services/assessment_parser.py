import re

QUESTIONS_RE = re.compile(r'<!--\s*questions\s*\n(.*?)-->', re.DOTALL)
STEPS_RE = re.compile(r'<!--\s*steps\s*\n(.*?)-->', re.DOTALL)
REQUIREMENTS_RE = re.compile(r'<!--\s*requirements\s*\n(.*?)-->', re.DOTALL)
GOAL_RE = re.compile(r'<!--\s*goal\s*\n(.*?)-->', re.DOTALL)

STEP_RE = re.compile(
    r'step:\s*(\d+)\s*\n'
    r'explanation:\s*"([^"]*)"\s*\n'
    r'prompt:\s*"([^"]*)"\s*\n'
    r'(?:validate:\s*"([^"]*)"|expected:\s*"([^"]*)")\s*$',
    re.DOTALL | re.MULTILINE
)

REQUIREMENT_RE = re.compile(
    r'requirement:\s*"([^"]*)"\s*\n'
    r'validate:\s*"([^"]*)"'
    r'(?:\s*\n\s*goal:\s*"([^"]*)")?',
    re.DOTALL
)

# Regex for bullet-format questions in <!-- questions --> blocks
# * question text
# - option text
# - option text
# - option text
# - option text
# Answer: A
QUESTION_LINE_RE = re.compile(r'^\*\s+(.*)')
OPTION_LINE_RE = re.compile(r'^-\s+(.*)')
ANSWER_LINE_RE = re.compile(r'^Answer:\s*([A-Da-d])', re.MULTILINE)


# ---------- content type normalizer ----------

TYPE_ALIASES = {
    'notes': 'note', 'note': 'note',
    'quiz': 'quiz', 'quizzes': 'quiz', 'quizs': 'quiz', 'quizes': 'quiz',
    'test': 'test', 'tests': 'test',
    'exam': 'exam', 'exams': 'exam',
    'workshop': 'workshop', 'workshops': 'workshop',
    'practical': 'practical', 'practicals': 'practical',
    'project': 'project', 'projects': 'project',
}


def normalize_type(raw):
    if not raw:
        return 'note'
    key = raw.strip().lower()
    return TYPE_ALIASES.get(key, key)


# ---------- question parser (bullet format) ----------

def _parse_question_items(text):
    items = []
    current = None

    for line in text.split('\n'):
        line_stripped = line.strip()

        qm = QUESTION_LINE_RE.match(line_stripped)
        if qm:
            if current:
                items.append(current)
            current = {'question': qm.group(1).strip(), 'options': []}
            continue

        om = OPTION_LINE_RE.match(line_stripped)
        if om and current is not None:
            current['options'].append(om.group(1).strip())
            continue

    if current:
        items.append(current)

    # Attach answers found via Answer: line
    answer_map = {}
    for m in ANSWER_LINE_RE.finditer(text):
        idx = text[:m.start()].count('*') - 1
        if idx >= 0:
            answer_map[idx] = m.group(1).upper()

    for i, item in enumerate(items):
        item['answer'] = answer_map.get(i, '')

    return items


# ---------- main parser ----------

VALID_TYPES = {'note', 'quiz', 'test', 'exam', 'workshop', 'practical'}


def parse_content(content_type, body):
    ct = normalize_type(content_type)

    if ct == 'note':
        questions = _parse_questions(body)
        if questions:
            return [{'type': 'quiz', 'questions': questions}]
        return []

    if ct in ('quiz', 'test', 'exam'):
        questions = _parse_questions(body)
        return [{'type': ct, 'questions': questions}]

    if ct == 'workshop':
        steps = _parse_steps(body)
        return [{'type': 'workshop', 'steps': steps}]

    if ct == 'practical':
        requirements = _parse_requirements(body)
        goal = _parse_goal(body)
        result = {'type': 'requirements', 'requirements': requirements}
        if goal:
            result['goal'] = goal
        return [result]

    return []


def _parse_questions(body):
    questions = []
    for match in QUESTIONS_RE.finditer(body):
        qs = _parse_question_items(match.group(1))
        questions.extend(qs)
    return questions


def _parse_steps(body):
    steps = []
    for match in STEPS_RE.finditer(body):
        for step_match in STEP_RE.finditer(match.group(1)):
            validate = step_match.group(4)
            expected = step_match.group(5)
            step = {
                'step': int(step_match.group(1)),
                'explanation': step_match.group(2),
                'prompt': step_match.group(3),
            }
            if validate:
                step['validate'] = validate
            else:
                step['expected'] = expected
            steps.append(step)
    steps.sort(key=lambda s: s['step'])
    return steps


def _parse_goal(body):
    for match in GOAL_RE.finditer(body):
        return match.group(1).strip()
    return ''


def _parse_requirements(body):
    reqs = []
    for match in REQUIREMENTS_RE.finditer(body):
        for req_match in REQUIREMENT_RE.finditer(match.group(1)):
            item = {
                'requirement': req_match.group(1),
                'validate': req_match.group(2),
            }
            if req_match.group(3):
                item['goal'] = req_match.group(3)
            reqs.append(item)
    return reqs


# ---------- helpers ----------

def get_assessment_mode(content_type):
    ct = normalize_type(content_type)
    if ct in ('quiz', 'test', 'exam'):
        return ct
    return None


def get_per_page(mode):
    return {'quiz': 1, 'test': 5, 'exam': 10}.get(mode, 5)


def get_min_errors(meta):
    return int(meta.get('min_errors', 0))
