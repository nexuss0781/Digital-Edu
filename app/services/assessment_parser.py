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
    'note': 'lecture', 'notes': 'lecture', 'lecture': 'lecture', 'lectures': 'lecture',
    'review': 'review', 'reviews': 'review',
    'quiz': 'quiz', 'quizzes': 'quiz', 'quizs': 'quiz', 'quizes': 'quiz',
    'test': 'test', 'tests': 'test',
    'exam': 'exam', 'exams': 'exam',
    'workshop': 'workshop', 'workshops': 'workshop',
    'practical': 'practical', 'practicals': 'practical',
    'project': 'project', 'projects': 'project',
}


def normalize_type(raw):
    if not raw:
        return 'lecture'
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

VALID_TYPES = {'lecture', 'quiz', 'test', 'exam', 'workshop', 'practical'}


def parse_content(content_type, body):
    ct = normalize_type(content_type)

    if ct == 'lecture':
        lecture_data = _parse_fcc_lecture(body)
        if lecture_data['questions']:
            return [{
                'type': 'lecture_quiz',
                'questions': lecture_data['questions'],
                'content_section': lecture_data['content_section'],
                'content_type': lecture_data['content_type'],
                'interactive_blocks': lecture_data['interactive_blocks'],
            }]
        questions = _parse_questions(body)
        if questions:
            return [{'type': 'quiz', 'questions': questions}]
        return []

    if ct in ('quiz', 'test', 'exam'):
        if ct in ('test', 'exam'):
            fcc_questions = _parse_fcc_test_questions(body)
            if fcc_questions:
                return [{'type': 'quiz', 'questions': fcc_questions, 'question_count': len(fcc_questions)}]
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


# ---------- FCC lecture parser ----------

def _parse_fcc_lecture(body):
    """Parse FCC-format lecture markdown into structured data."""
    result = {
        'content_section': '',
        'content_type': 'description',
        'interactive_blocks': [],
        'questions': [],
    }

    if not body or not body.strip():
        return result

    questions_match = re.search(r'^# --questions--\s*$', body, re.MULTILINE)

    if questions_match:
        content_raw = body[:questions_match.start()].strip()
        questions_raw = body[questions_match.end():].strip()
    else:
        content_raw = body.strip()
        questions_raw = ''

    if content_raw.startswith('# --interactive--'):
        result['content_type'] = 'interactive'
        content_raw = content_raw[len('# --interactive--'):].strip()
    elif content_raw.startswith('# --description--'):
        result['content_type'] = 'description'
        content_raw = content_raw[len('# --description--'):].strip()

    content_raw = re.sub(r'^# --assignment--\s*\n?', '', content_raw, flags=re.MULTILINE).strip()
    content_raw = re.sub(r'^# --instructions--\s*\n?', '', content_raw, flags=re.MULTILINE).strip()

    editor_pattern = re.compile(r':::interactive_editor\s*\n(.*?)\n:::', re.DOTALL)
    blocks = []
    for m in editor_pattern.finditer(content_raw):
        block_content = m.group(1).strip()
        code_pattern = re.compile(r'```(\w+)\s*\n(.*?)```', re.DOTALL)
        for code_m in code_pattern.finditer(block_content):
            blocks.append({
                'lang': code_m.group(1).lower(),
                'code': code_m.group(2).strip(),
            })
    result['interactive_blocks'] = blocks

    cleaned = editor_pattern.sub('', content_raw).strip()
    cleaned = re.sub(r'^:::\s*$', '', cleaned, flags=re.MULTILINE).strip()
    result['content_section'] = cleaned

    if questions_raw:
        result['questions'] = _parse_fcc_questions(questions_raw)

    return result


def _parse_fcc_questions(text):
    """Parse FCC question format into structured question list."""
    questions = []
    parts = re.split(r'^## --text--\s*$', text, flags=re.MULTILINE)

    for part in parts[1:]:
        question = _parse_single_fcc_question(part.strip())
        if question:
            questions.append(question)

    return questions


def _parse_single_fcc_question(text):
    """Parse a single FCC question block."""
    answers_split = re.split(r'^## --answers--\s*$', text, flags=re.MULTILINE)
    if len(answers_split) < 2:
        return None

    question_text = answers_split[0].strip()
    answers_raw = answers_split[1].strip()

    video_match = re.search(r'^## --video-solution--\s*\n\s*(\d+)', answers_raw, re.MULTILINE)
    correct_index = 0
    if video_match:
        correct_index = int(video_match.group(1)) - 1
        answers_raw = answers_raw[:video_match.start()].strip()

    answer_parts = re.split(r'^---\s*$', answers_raw, flags=re.MULTILINE)

    options = []
    for ans in answer_parts:
        ans = ans.strip()
        if not ans:
            continue

        feedback_match = re.search(r'^### --feedback--\s*\n\s*(.*?)$', ans, re.MULTILINE | re.DOTALL)
        feedback = None
        answer_text = ans
        if feedback_match:
            feedback = feedback_match.group(1).strip()
            answer_text = ans[:feedback_match.start()].strip()

        options.append({
            'text': answer_text,
            'feedback': feedback,
        })

    if not options:
        return None

    return {
        'text': question_text,
        'options': options,
        'correct_index': min(correct_index, len(options) - 1),
    }


# ---------- FCC test/quiz parser ----------

def _parse_fcc_test_questions(body):
    """Parse FCC test/quiz format (# --quizzes--) into structured question list.

    Format:
      # --quizzes--
        ## --quiz--
          ### --question--
            #### --text--
            #### --distractors--  (3 options, --- separated)
            #### --answer--
    """
    questions = []

    quizzes_match = re.search(r'^# --quizzes--\s*$', body, re.MULTILINE)
    if not quizzes_match:
        return questions

    quizzes_raw = body[quizzes_match.end():].strip()
    quiz_sections = re.split(r'^## --quiz--\s*$', quizzes_raw, flags=re.MULTILINE)

    for quiz_section in quiz_sections[1:]:
        question_blocks = re.split(r'^### --question--\s*$', quiz_section, flags=re.MULTILINE)

        for qblock in question_blocks[1:]:
            qblock = qblock.strip()
            if not qblock:
                continue

            text_m = re.search(r'^#### --text--\s*\n(.*?)(?=^#### --)', qblock, re.MULTILINE | re.DOTALL)
            if not text_m:
                continue

            question_text = text_m.group(1).strip()

            dist_m = re.search(r'^#### --distractors--\s*\n(.*?)(?=^#### --)', qblock, re.MULTILINE | re.DOTALL)
            distractors = []
            if dist_m:
                parts = re.split(r'^---\s*$', dist_m.group(1).strip(), flags=re.MULTILINE)
                distractors = [p.strip() for p in parts if p.strip()]

            ans_m = re.search(r'^#### --answer--\s*\n(.*?)(?=^#### --|\Z)', qblock, re.MULTILINE | re.DOTALL)
            correct_answer = ans_m.group(1).strip() if ans_m else ''

            options = [{'text': d, 'feedback': None} for d in distractors]
            options.append({'text': correct_answer, 'feedback': None})

            questions.append({
                'text': question_text,
                'options': options,
                'correct_index': len(distractors),
            })

    return questions


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
