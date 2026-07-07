import re
import os
import yaml
from html.parser import HTMLParser


# ---------------------------------------------------------------------------
# HTML Tree Parser
# ---------------------------------------------------------------------------

class HTMLNode:
    def __init__(self, tag, attrs=None, parent=None):
        self.tag = tag
        self.attrs = dict(attrs) if attrs else {}
        self.children = []
        self.text = ''
        self.parent = parent

    def find(self, tag):
        results = []
        for child in self.children:
            if child.tag == tag:
                results.append(child)
            results.extend(child.find(tag))
        return results

    def find_all(self):
        results = [self]
        for child in self.children:
            results.extend(child.find_all())
        return results

    def has_attribute(self, attr_name):
        return attr_name in self.attrs

    def get_attribute(self, attr_name):
        return self.attrs.get(attr_name, '')

    def has_class(self, class_name):
        class_str = self.attrs.get('class', '')
        return class_name in class_str.split()

    def has_text(self):
        return bool(self.text.strip())


class HTMLTreeBuilder(HTMLParser):
    SELF_CLOSING = {
        'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr',
    }

    def __init__(self):
        super().__init__()
        self.root = HTMLNode('root')
        self.stack = [self.root]
        self.current_text = ''

    def handle_starttag(self, tag, attrs):
        self._flush_text()
        tag_lower = tag.lower()
        parent = self.stack[-1]
        node = HTMLNode(tag_lower, attrs, parent)
        parent.children.append(node)
        if tag_lower not in self.SELF_CLOSING:
            self.stack.append(node)

    def handle_endtag(self, tag):
        self._flush_text()
        tag_lower = tag.lower()
        if tag_lower not in self.SELF_CLOSING:
            for i in range(len(self.stack) - 1, 0, -1):
                if self.stack[i].tag == tag_lower:
                    self.stack.pop(i)
                    break

    def handle_data(self, data):
        self.current_text += data

    def _flush_text(self):
        if self.current_text.strip() and self.stack:
            self.stack[-1].text += self.current_text
        self.current_text = ''

    def get_tree(self):
        self._flush_text()
        return self.root


def build_html_tree(code):
    builder = HTMLTreeBuilder()
    try:
        builder.feed(code)
    except Exception:
        pass
    return builder.get_tree()


# ---------------------------------------------------------------------------
# CSS Extractor
# ---------------------------------------------------------------------------

def extract_css_properties(code):
    props = {}

    for match in re.finditer(r'<style[^>]*>(.*?)</style>', code, re.DOTALL | re.IGNORECASE):
        block = match.group(1)
        for prop_match in re.finditer(
            r'([a-zA-Z-]+)\s*:\s*([^;}{]+)', block
        ):
            prop = prop_match.group(1).strip().lower()
            val = prop_match.group(2).strip()
            props[prop] = val

    for match in re.finditer(r'style\s*=\s*"([^"]*)"', code, re.IGNORECASE):
        style_str = match.group(1)
        for prop_match in re.finditer(
            r'([a-zA-Z-]+)\s*:\s*([^;]+)', style_str
        ):
            prop = prop_match.group(1).strip().lower()
            val = prop_match.group(2).strip()
            props[prop] = val

    for match in re.finditer(r"style\s*=\s*'([^']*)'", code, re.IGNORECASE):
        style_str = match.group(1)
        for prop_match in re.finditer(
            r'([a-zA-Z-]+)\s*:\s*([^;]+)', style_str
        ):
            prop = prop_match.group(1).strip().lower()
            val = prop_match.group(2).strip()
            props[prop] = val

    return props


# ---------------------------------------------------------------------------
# Template Loader — loads rule definitions from templates/ directory
# ---------------------------------------------------------------------------

def load_templates(templates_dir):
    """Load all YAML rule files from a templates directory.

    Each YAML file can contain multiple rules as top-level keys:
        rule_name:
            template: tag_exists
            tag: head
            hint: "Add <head> tags"

    All rules from all .yaml/.yml files are merged into a single dict.
    Later files override earlier ones for the same rule name.
    """
    rules = {}
    if not templates_dir or not os.path.isdir(templates_dir):
        return rules

    for fname in sorted(os.listdir(templates_dir)):
        if not (fname.endswith('.yaml') or fname.endswith('.yml')):
            continue
        fpath = os.path.join(templates_dir, fname)
        with open(fpath, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f) or {}
        if isinstance(data, dict):
            rules.update(data)

    return rules


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------

class Validator:
    """Global validation library.

    Provides template functions (building blocks) and executes rules
    defined by content creators. Rules are loaded from the templates/
    directory or specified inline.

    Simple templates:
        - tag: check if a tag exists (opening + optional closing)
        - wrapper: check if one element wraps another

    Usage:
        v = Validator()
        passed, hint = v.validate(rule_def, code)
    """

    def __init__(self):
        self.templates = {
            # Simple templates (user-friendly)
            'tag': self._tag,
            'wrapper': self._wrapper,
            # Legacy templates (backward compat)
            'tag_exists': self._tag_exists,
            'tag_has_closing': self._tag_has_closing,
            'tag_nested': self._tag_nested,
            'tag_has_attribute': self._tag_has_attribute,
            'tag_has_text': self._tag_has_text,
            'tag_has_class': self._tag_has_class,
            'tag_has_id': self._tag_has_id,
            'css_property': self._css_property,
            'contains': self._contains,
            'regex': self._regex,
            'line_count_min': self._line_count_min,
            'legacy_exact': self._legacy_exact,
        }
        self._cached_rules = None
        self._cache_dir = None

    def _get_templates_dir(self):
        """Get the templates directory from Flask config."""
        try:
            from flask import current_app
            return current_app.config.get('TEMPLATES_DIR', '')
        except RuntimeError:
            return ''

    def _get_cached_rules(self):
        """Load and cache rules from templates/ directory."""
        templates_dir = self._get_templates_dir()
        if templates_dir != self._cache_dir or self._cached_rules is None:
            self._cache_dir = templates_dir
            self._cached_rules = load_templates(templates_dir)
        return self._cached_rules

    def invalidate_cache(self):
        """Force reload of templates on next access."""
        self._cached_rules = None
        self._cache_dir = None

    def validate(self, rule_def, code):
        """Execute a rule definition against code.

        Args:
            rule_def: dict with 'template', params, and optional 'hint'
            code: the student's code string

        Returns:
            (passed: bool, hint: str)
        """
        template_name = rule_def.get('template', '')
        hint = rule_def.get('hint', '')

        handler = self.templates.get(template_name)
        if not handler:
            return False, f"Unknown template: {template_name}"

        params = {k: v for k, v in rule_def.items() if k not in ('template', 'hint')}
        passed = handler(code, **params)
        if passed:
            return True, ''
        return False, hint

    def resolve_and_validate(self, rule_string, code):
        """Resolve a rule string and validate against code.

        Args:
            rule_string: rule name (templates/ lookup) or inline template:params
            code: the student's code string

        Returns:
            (passed: bool, hint: str)
        """
        rule_def = self.resolve_rule(rule_string)
        if rule_def is None:
            return False, f"Rule not found: {rule_string}"
        return self.validate(rule_def, code)

    def resolve_rule(self, rule_string):
        """Resolve a rule string to a rule definition dict.

        Resolution order:
        1. If contains ':' → inline: template:param1:param2
        2. Look up in templates/ directory (loaded from YAML files)
        """
        if ':' in rule_string:
            return self._parse_inline_rule(rule_string)

        rules = self._get_cached_rules()
        if rule_string in rules:
            return rules[rule_string]

        return None

    def _parse_inline_rule(self, rule_string):
        """Parse inline rule format: template:param1:param2:..."""
        parts = rule_string.split(':')
        template = parts[0]

        if template not in self.templates:
            return None

        sig = self._get_template_params(template)
        params = {}
        for i, param_name in enumerate(sig):
            if i + 1 < len(parts):
                params[param_name] = parts[i + 1]

        return {'template': template, **params}

    def _get_template_params(self, template_name):
        """Get parameter names for a template function."""
        param_map = {
            # Simple templates
            'tag': ['element', 'closing', 'attribute', 'value'],
            'wrapper': ['wrapper', 'wrapped', 'frequency'],
            # Legacy templates
            'tag_exists': ['tag'],
            'tag_has_closing': ['tag'],
            'tag_nested': ['parent', 'child'],
            'tag_has_attribute': ['tag', 'attr'],
            'tag_has_text': ['tag'],
            'tag_has_class': ['tag', 'class_name'],
            'tag_has_id': ['id_name'],
            'css_property': ['property', 'value'],
            'contains': ['value'],
            'regex': ['pattern'],
            'line_count_min': ['count'],
            'legacy_exact': ['expected'],
        }
        return param_map.get(template_name, [])

    # -------------------------------------------------------------------
    # Template Functions — Simple (User-Friendly)
    # -------------------------------------------------------------------

    def _tag(self, code, element='', closing='yes', attribute='', value=''):
        """Check if a tag exists with optional closing and attribute checks.

        Structured syntax:
            template: tag
            element: <tag_name>       # required - tag to check
            closing: yes/no           # optional - require closing tag
            attribute: <attr_name>    # optional - check attribute exists
            value: <attr_value>       # optional - check attribute has value

        Args:
            code: HTML code to check
            element: tag name (e.g., 'head', 'div', 'meta', 'a')
            closing: 'yes'/true to require closing tag, 'no'/false for self-closing
            attribute: attribute name to check (e.g., 'href', 'src', 'alt')
            value: attribute value to check (e.g., 'google.com', '_blank')

        Returns:
            True if all checks pass
        """
        element_lower = element.lower()
        tree = build_html_tree(code)
        tags = tree.find(element_lower)

        if not tags:
            return False

        # Handle YAML boolean (True/False) or string ('yes'/'no')
        if isinstance(closing, bool):
            require_closing = closing
        else:
            require_closing = str(closing).lower() == 'yes'

        # Check closing tag if required
        if require_closing:
            pattern = re.compile(r'</\s*' + re.escape(element_lower) + r'\s*>', re.IGNORECASE)
            if not pattern.search(code):
                return False

        # Check attribute if specified
        if attribute:
            for tag in tags:
                if not tag.has_attribute(attribute):
                    continue
                # Check value if specified
                if value:
                    attr_value = tag.get_attribute(attribute)
                    if value.lower() in attr_value.lower():
                        return True
                else:
                    return True
            return False

        return True

    def _wrapper(self, code, wrapper='', wrapped='', frequency=''):
        """Check if one element wraps another.

        Args:
            code: HTML code to check
            wrapper: parent tag name (e.g., 'head', 'body')
            wrapped: child tag name (e.g., 'title', 'div')
            frequency: optional - how many times wrapped must appear

        Returns:
            True if wrapper contains wrapped (and frequency if specified)
        """
        tree = build_html_tree(code)
        parents = tree.find(wrapper.lower())

        if not parents:
            return False

        for parent in parents:
            children = parent.find(wrapped.lower())
            if frequency:
                try:
                    freq = int(frequency)
                    if len(children) >= freq:
                        return True
                except ValueError:
                    pass
            else:
                if children:
                    return True

        return False

    # -------------------------------------------------------------------
    # Template Functions — HTML (Legacy)
    # -------------------------------------------------------------------

    def _tag_exists(self, code, tag=''):
        tree = build_html_tree(code)
        return len(tree.find(tag)) > 0

    def _tag_has_closing(self, code, tag=''):
        tag_lower = tag.lower()
        pattern = re.compile(r'</\s*' + re.escape(tag_lower) + r'\s*>', re.IGNORECASE)
        return bool(pattern.search(code))

    def _tag_nested(self, code, parent='', child=''):
        tree = build_html_tree(code)
        parents = tree.find(parent)
        for p in parents:
            if p.find(child):
                return True
        return False

    def _tag_has_attribute(self, code, tag='', attr=''):
        tree = build_html_tree(code)
        tags = tree.find(tag)
        for t in tags:
            if t.has_attribute(attr):
                return True
        return False

    def _tag_has_text(self, code, tag=''):
        tree = build_html_tree(code)
        tags = tree.find(tag)
        for t in tags:
            if t.has_text():
                return True
        return False

    def _tag_has_class(self, code, tag='', class_name=''):
        tree = build_html_tree(code)
        tags = tree.find(tag)
        for t in tags:
            if t.has_class(class_name):
                return True
        return False

    def _tag_has_id(self, code, id_name=''):
        tree = build_html_tree(code)
        all_nodes = tree.find_all()
        for node in all_nodes:
            if node.get_attribute('id') == id_name:
                return True
        return False

    # -------------------------------------------------------------------
    # Template Functions — CSS
    # -------------------------------------------------------------------

    def _css_property(self, code, property='', value=''):
        props = extract_css_properties(code)
        prop_lower = property.lower()
        if prop_lower in props:
            prop_val = props[prop_lower].lower().strip()
            val_lower = value.lower().strip()
            return val_lower in prop_val or prop_val == val_lower
        return False

    # -------------------------------------------------------------------
    # Template Functions — General
    # -------------------------------------------------------------------

    def _contains(self, code, value=''):
        return value in code

    def _regex(self, code, pattern=''):
        try:
            return bool(re.search(pattern, code))
        except re.error:
            return False

    def _line_count_min(self, code, count='0'):
        try:
            min_count = int(count)
        except ValueError:
            return False
        return len(code.strip().splitlines()) >= min_count

    def _legacy_exact(self, code, expected=''):
        return code.strip() == expected.strip()


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_validator = Validator()


def validate_rule(rule_def, code):
    """Convenience function: execute a rule definition against code."""
    return _validator.validate(rule_def, code)


def validate_string(rule_string, code):
    """Convenience function: resolve a rule string and validate."""
    return _validator.resolve_and_validate(rule_string, code)


def get_validator():
    """Return the module-level validator instance."""
    return _validator
