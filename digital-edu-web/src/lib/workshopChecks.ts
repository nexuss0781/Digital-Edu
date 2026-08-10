export interface WorkshopHint {
  text: string;
  code: string;
}

export interface CheckResult {
  text: string;
  passed: boolean;
  error?: string;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return a == b;
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function fail(message?: string): never {
  throw new Error(message || 'assertion failed');
}

function makeAssert() {
  const assert: Record<string, (...args: unknown[]) => void> = {};
  const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
  assert.equal = (actual, expected, msg) => {
    if (!(actual == expected)) fail(str(msg) || `expected ${str(actual)} == ${str(expected)}`);
  };
  assert.notEqual = (actual, expected, msg) => {
    if (actual == expected) fail(str(msg) || `expected ${str(actual)} != ${str(expected)}`);
  };
  assert.strictEqual = (actual, expected, msg) => {
    if (actual !== expected) fail(str(msg) || `expected ${str(actual)} === ${str(expected)}`);
  };
  assert.notStrictEqual = (actual, expected, msg) => {
    if (actual === expected) fail(str(msg) || `expected ${str(actual)} !== ${str(expected)}`);
  };
  assert.deepStrictEqual = (actual, expected, msg) => {
    if (!deepEqual(actual, expected)) fail(str(msg) || 'expected deep strict equality');
  };
  assert.notDeepEqual = (actual, expected, msg) => {
    if (deepEqual(actual, expected)) fail(str(msg) || 'expected deep inequality');
  };
  assert.exists = (value, msg) => {
    if (value == null) fail(str(msg) || 'expected value to exist');
  };
  assert.notExists = (value, msg) => {
    if (value != null) fail(str(msg) || 'expected value to not exist');
  };
  assert.isNull = (value, msg) => {
    if (value !== null) fail(str(msg) || 'expected null');
  };
  assert.isNotNull = (value, msg) => {
    if (value === null || value === undefined) fail(str(msg) || 'expected non-null value');
  };
  assert.isDefined = (value, msg) => {
    if (value === undefined) fail(str(msg) || 'expected defined value');
  };
  assert.isUndefined = (value, msg) => {
    if (value !== undefined) fail(str(msg) || 'expected undefined');
  };
  assert.isTrue = (value, msg) => {
    if (value !== true) fail(str(msg) || 'expected true');
  };
  assert.isFalse = (value, msg) => {
    if (value !== false) fail(str(msg) || 'expected false');
  };
  assert.isNaN = (value, msg) => {
    if (!Number.isNaN(Number(value))) fail(str(msg) || 'expected NaN');
  };
  assert.isNotNaN = (value, msg) => {
    if (Number.isNaN(Number(value))) fail(str(msg) || 'expected non-NaN');
  };
  assert.lengthOf = (value, expected, msg) => {
    const len = (value as { length?: number }).length;
    if (len !== expected) fail(str(msg) || `expected length ${str(len)} === ${str(expected)}`);
  };
  assert.isEmpty = (value, msg) => {
    if ((value as { length?: number }).length !== 0) fail(str(msg) || 'expected empty collection');
  };
  assert.isNotEmpty = (value, msg) => {
    if (!(value as { length?: number }).length) fail(str(msg) || 'expected non-empty collection');
  };
  assert.notEmpty = (value, msg) => {
    if (!(value as { length?: number }).length) fail(str(msg) || 'expected non-empty collection');
  };
  assert.include = (haystack, needle, msg) => {
    if (!(haystack as { includes(s: unknown): boolean }).includes(needle)) {
      fail(str(msg) || 'expected value to include needle');
    }
  };
  assert.notInclude = (haystack, needle, msg) => {
    if ((haystack as { includes(s: unknown): boolean }).includes(needle)) {
      fail(str(msg) || 'expected value to not include needle');
    }
  };
  assert.match = (value, pattern, msg) => {
    if (!(pattern as RegExp).test(str(value))) fail(str(msg) || `expected ${str(value)} to match pattern`);
  };
  assert.notMatch = (value, pattern, msg) => {
    if ((pattern as RegExp).test(str(value))) fail(str(msg) || 'expected value to not match pattern');
  };
  assert.oneOf = (value, list, msg) => {
    if (!(list as unknown[]).includes(value)) fail(str(msg) || 'expected value to be one of the list');
  };
  assert.isAtLeast = (actual, expected, msg) => {
    if (!(Number(actual) >= Number(expected))) fail(str(msg) || `expected ${str(actual)} >= ${str(expected)}`);
  };
  assert.isAtMost = (actual, expected, msg) => {
    if (!(Number(actual) <= Number(expected))) fail(str(msg) || `expected ${str(actual)} <= ${str(expected)}`);
  };
  assert.isBelow = (actual, expected, msg) => {
    if (!(Number(actual) < Number(expected))) fail(str(msg) || `expected ${str(actual)} < ${str(expected)}`);
  };
  assert.isAbove = (actual, expected, msg) => {
    if (!(Number(actual) > Number(expected))) fail(str(msg) || `expected ${str(actual)} > ${str(expected)}`);
  };
  assert.notThrow = (fn, msg) => {
    try {
      if (typeof fn === 'function') (fn as () => void)();
    } catch (e) {
      fail(str(msg) || `expected no throw, got ${(e as Error).message}`);
    }
  };
  return assert;
}

interface StyleLike {
  selectorText?: string;
  style?: CSSStyleDeclaration;
}

interface RuleContainer {
  cssRules: CSSRuleList;
}

function collectRules(
  sheet: RuleContainer,
  out: CSSRule[] = [],
  mediaQuery?: string
): CSSRule[] {
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    return out;
  }
  for (const rule of Array.from(rules) as CSSRule[]) {
    if (rule instanceof CSSMediaRule) {
      if (mediaQuery === undefined) {
        out.push(...collectRules(rule, out, rule.conditionText));
      } else if (rule.conditionText === mediaQuery) {
        for (const inner of Array.from(rule.cssRules) as CSSRule[]) {
          out.push(inner);
        }
      }
    } else if (rule instanceof CSSSupportsRule) {
      out.push(...collectRules(rule, out, mediaQuery));
    } else {
      out.push(rule);
    }
  }
  return out;
}

function allStyleSheets(doc: Document): CSSStyleSheet[] {
  const sheets: CSSStyleSheet[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      const owner = sheet.ownerNode as HTMLElement | null;
      if (owner && owner.classList && owner.classList.contains('fcc-hide-header')) continue;
      sheets.push(sheet);
    } catch {
      continue;
    }
  }
  return sheets;
}

function allRules(doc: Document): CSSRule[] {
  const rules: CSSRule[] = [];
  for (const sheet of allStyleSheets(doc)) {
    for (const rule of collectRules(sheet)) {
      rules.push(rule);
    }
  }
  return rules.filter((r) => r instanceof CSSStyleRule);
}

function styleRules(doc: Document): CSSStyleRule[] {
  return allRules(doc) as CSSStyleRule[];
}

function toCamelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

function valueOfStyle(style: CSSStyleDeclaration, name: string): string {
  const dashed = name.startsWith('--')
    ? name
    : name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const direct = style.getPropertyValue(dashed);
  if (direct !== '') return direct.trim();
  const camel = toCamelCase(name);
  const viaCamel = (style as unknown as Record<string, string>)[camel];
  if (typeof viaCamel === 'string' && viaCamel !== '') return viaCamel.trim();
  return '';
}

function buildStyleProxy(rule: CSSStyleRule): Record<string, unknown> {
  const style = rule.style;
  const target: Record<string, unknown> = {
    getPropertyValue: (name: string) => valueOfStyle(style, name),
    getPropVal: (name: string) => valueOfStyle(style, name),
    ln: (name: string) => valueOfStyle(style, name),
  };
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === 'string' && prop in obj) return Reflect.get(obj, prop, receiver);
      if (typeof prop === 'string') return valueOfStyle(style, prop);
      return Reflect.get(obj, prop, receiver);
    },
  }) as Record<string, unknown>;
}

function makeHelpers(doc: Document) {
  class CSSHelp {
    doc: Document;
    constructor(d: Document) {
      this.doc = d;
    }
    getStyle(selector: string): Record<string, unknown> | null {
      const rule = styleRules(this.doc).find((r) => r.selectorText === selector);
      return rule ? buildStyleProxy(rule) : null;
    }
    getStyleAny(selectorOrSelectors: string | string[]): Record<string, unknown> | null {
      const selectors = Array.isArray(selectorOrSelectors) ? selectorOrSelectors : [selectorOrSelectors];
      for (const sel of selectors) {
        const found = this.getStyle(sel);
        if (found) return found;
      }
      return null;
    }
    getStyleDeclarations(selector: string): CSSStyleRule[] {
      return styleRules(this.doc).filter((r) => r.selectorText === selector);
    }
    getCSSRules(): CSSStyleRule[] {
      return styleRules(this.doc);
    }
    getRuleListsWithinMedia(mediaQuery: string): CSSStyleRule[] {
      const rules: CSSStyleRule[] = [];
      for (const sheet of allStyleSheets(this.doc)) {
        for (const rule of collectRules(sheet, [], mediaQuery)) {
          if (rule instanceof CSSStyleRule) rules.push(rule);
        }
      }
      return rules;
    }
    isPropertyUsed(prop: string): CSSStyleRule | null {
      return (
        styleRules(this.doc).find((r) => r.style.getPropertyValue(prop) !== '') || null
      );
    }
  }

  return {
    CSSHelp,
    removeCssComments: (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, ''),
    removeWhiteSpace: (str: string) => str.replace(/\s/g, ''),
    permutateRegex: (patterns: string[], opts: { elementsSeparator?: string } = {}) => {
      const sep = opts.elementsSeparator ?? '\\s+';
      const perms: string[][] = [];
      const permute = (arr: string[], prefix: string[] = []) => {
        if (arr.length === 0) {
          perms.push(prefix);
          return;
        }
        for (let i = 0; i < arr.length; i++) {
          const rest = arr.slice(0, i).concat(arr.slice(i + 1));
          permute(rest, prefix.concat(arr[i]));
        }
      };
      permute(patterns);
      const alts = perms.map((p) => p.join(sep));
      return new RegExp(`(?:${alts.join('|')})`);
    },
    concatRegex: (...regexes: RegExp[]) => new RegExp(regexes.map((r) => r.source).join('')),
  };
}

export function runStepChecks(
  hints: WorkshopHint[],
  code: string,
  win: Window
): CheckResult[] {
  const assert = makeAssert();
  const helpers = makeHelpers(win.document);

  return hints.map((hint) => {
    if (!hint.code.trim()) {
      return { text: hint.text, passed: true };
    }
    try {
      const FunctionCtor = (win as unknown as { Function: typeof Function }).Function;
      const fn = FunctionCtor('assert', '__helpers', 'code', hint.code) as (
        assert: unknown,
        helpers: unknown,
        code: string
      ) => unknown;
      fn(assert, helpers, code);
      return { text: hint.text, passed: true };
    } catch (e) {
      return { text: hint.text, passed: false, error: (e as Error).message || String(e) };
    }
  });
}
