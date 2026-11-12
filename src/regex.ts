/**
 * XML Schema / XPath regular expressions, as used by the FEEL `matches`,
 * `replace` and `split` functions, translated to JavaScript regular
 * expressions.
 *
 * @see https://www.w3.org/TR/xpath-functions-31/#regex-syntax
 * @see https://www.w3.org/TR/xmlschema-2/#regexs
 */

/**
 * An invalid pattern, flags or replacement string.
 *
 * The message is a template that may refer to `values`.
 */
export class RegexError extends Error {
  constructor(
      message: string,
      readonly values: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

/**
 * Whether `input` matches the given pattern.
 */
export function matches(input: string, pattern: string, flags: string): boolean {
  return compile(pattern, flags).test(input);
}

/**
 * Replace all matches of the given pattern in `input`
 * with an XPath replacement string.
 */
export function replace(input: string, pattern: string, replacement: string, flags: string): string {
  const regexp = compile(pattern, flags, 'g');

  if (nonGlobal(regexp).test('')) {
    throw new RegexError('expects a pattern that does not match the empty string, got {pattern}', {
      pattern
    });
  }

  if (flags.includes('q')) {
    return input.replace(regexp, () => replacement);
  }

  return input.replace(regexp, createReplacer(replacement, countGroups(regexp)));
}

/**
 * Split `input` at every match of the given pattern.
 */
export function split(input: string, delimiter: string): string[] {
  const regexp = compile(delimiter, '', '', 'delimiter');

  // String#split includes captured groups in the result, XPath does not
  const groups = countGroups(regexp);

  return input.split(regexp).filter((_, index) => index % (groups + 1) === 0);
}


// compilation ///////////////

type Range = [ number, number ];

type ClassAtom = {

  /**
   * Set for a single character, unset for a set of characters.
   */
  codePoint?: number,

  /**
   * JavaScript source, valid within a character class.
   */
  source: string
};

const FLAGS_PATTERN = /^[smixq]*$/;

const WHITESPACE_PATTERN = /[\t\n\r ]/;

const LITERAL_PATTERN = /[\\^$.*+?()[\]{}|]/g;

const DIGIT_PATTERN = /[0-9]/;

const MAX_CODE_POINT = 0x10FFFF;

// characters that may be escaped (`\n`, `\.`, ...)
const SINGLE_CHAR_ESCAPES = '\\|.-^?*+{}()[]$';

const CONTROL_ESCAPES = {
  n: '\\n',
  r: '\\r',
  t: '\\t'
};

const CATEGORIES = new Set([
  'L', 'Lu', 'Ll', 'Lt', 'Lm', 'Lo',
  'M', 'Mn', 'Mc', 'Me',
  'N', 'Nd', 'Nl', 'No',
  'P', 'Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po',
  'Z', 'Zs', 'Zl', 'Zp',
  'S', 'Sm', 'Sc', 'Sk', 'So',
  'C', 'Cc', 'Cf', 'Co', 'Cn'
]);

// Unicode blocks, as listed by XML Schema 1.0, plus current Unicode names
// of renamed blocks; usable as `\p{IsBasicLatin}`
const BLOCKS = new Map(Object.entries({
  'BasicLatin': '0-7F',
  'Latin-1Supplement': '80-FF',
  'LatinExtended-A': '100-17F',
  'LatinExtended-B': '180-24F',
  'IPAExtensions': '250-2AF',
  'SpacingModifierLetters': '2B0-2FF',
  'CombiningDiacriticalMarks': '300-36F',
  'Greek': '370-3FF',
  'GreekandCoptic': '370-3FF',
  'Cyrillic': '400-4FF',
  'Armenian': '530-58F',
  'Hebrew': '590-5FF',
  'Arabic': '600-6FF',
  'Syriac': '700-74F',
  'Thaana': '780-7BF',
  'Devanagari': '900-97F',
  'Bengali': '980-9FF',
  'Gurmukhi': 'A00-A7F',
  'Gujarati': 'A80-AFF',
  'Oriya': 'B00-B7F',
  'Tamil': 'B80-BFF',
  'Telugu': 'C00-C7F',
  'Kannada': 'C80-CFF',
  'Malayalam': 'D00-D7F',
  'Sinhala': 'D80-DFF',
  'Thai': 'E00-E7F',
  'Lao': 'E80-EFF',
  'Tibetan': 'F00-FFF',
  'Myanmar': '1000-109F',
  'Georgian': '10A0-10FF',
  'HangulJamo': '1100-11FF',
  'Ethiopic': '1200-137F',
  'Cherokee': '13A0-13FF',
  'UnifiedCanadianAboriginalSyllabics': '1400-167F',
  'Ogham': '1680-169F',
  'Runic': '16A0-16FF',
  'Khmer': '1780-17FF',
  'Mongolian': '1800-18AF',
  'LatinExtendedAdditional': '1E00-1EFF',
  'GreekExtended': '1F00-1FFF',
  'GeneralPunctuation': '2000-206F',
  'SuperscriptsandSubscripts': '2070-209F',
  'CurrencySymbols': '20A0-20CF',
  'CombiningMarksforSymbols': '20D0-20FF',
  'CombiningDiacriticalMarksforSymbols': '20D0-20FF',
  'LetterlikeSymbols': '2100-214F',
  'NumberForms': '2150-218F',
  'Arrows': '2190-21FF',
  'MathematicalOperators': '2200-22FF',
  'MiscellaneousTechnical': '2300-23FF',
  'ControlPictures': '2400-243F',
  'OpticalCharacterRecognition': '2440-245F',
  'EnclosedAlphanumerics': '2460-24FF',
  'BoxDrawing': '2500-257F',
  'BlockElements': '2580-259F',
  'GeometricShapes': '25A0-25FF',
  'MiscellaneousSymbols': '2600-26FF',
  'Dingbats': '2700-27BF',
  'BraillePatterns': '2800-28FF',
  'CJKRadicalsSupplement': '2E80-2EFF',
  'KangxiRadicals': '2F00-2FDF',
  'IdeographicDescriptionCharacters': '2FF0-2FFF',
  'CJKSymbolsandPunctuation': '3000-303F',
  'Hiragana': '3040-309F',
  'Katakana': '30A0-30FF',
  'Bopomofo': '3100-312F',
  'HangulCompatibilityJamo': '3130-318F',
  'Kanbun': '3190-319F',
  'BopomofoExtended': '31A0-31BF',
  'EnclosedCJKLettersandMonths': '3200-32FF',
  'CJKCompatibility': '3300-33FF',
  'CJKUnifiedIdeographsExtensionA': '3400-4DB5',
  'CJKUnifiedIdeographs': '4E00-9FFF',
  'YiSyllables': 'A000-A48F',
  'YiRadicals': 'A490-A4CF',
  'HangulSyllables': 'AC00-D7A3',
  'HighSurrogates': 'D800-DB7F',
  'HighPrivateUseSurrogates': 'DB80-DBFF',
  'LowSurrogates': 'DC00-DFFF',
  'PrivateUse': 'E000-F8FF F0000-FFFFD 100000-10FFFD',
  'PrivateUseArea': 'E000-F8FF',
  'CJKCompatibilityIdeographs': 'F900-FAFF',
  'AlphabeticPresentationForms': 'FB00-FB4F',
  'ArabicPresentationForms-A': 'FB50-FDFF',
  'CombiningHalfMarks': 'FE20-FE2F',
  'CJKCompatibilityForms': 'FE30-FE4F',
  'SmallFormVariants': 'FE50-FE6F',
  'ArabicPresentationForms-B': 'FE70-FEFE',
  'Specials': 'FEFF-FEFF FFF0-FFFD',
  'HalfwidthandFullwidthForms': 'FF00-FFEF',
  'OldItalic': '10300-1032F',
  'Gothic': '10330-1034F',
  'Deseret': '10400-1044F',
  'ByzantineMusicalSymbols': '1D000-1D0FF',
  'MusicalSymbols': '1D100-1D1FF',
  'MathematicalAlphanumericSymbols': '1D400-1D7FF',
  'CJKUnifiedIdeographsExtensionB': '20000-2A6D6',
  'CJKCompatibilityIdeographsSupplement': '2F800-2FA1F',
  'Tags': 'E0000-E007F'
}));

// XML NameStartChar and NameChar, as matched by `\i` and `\c`
const NAME_START_CHARS = parseRanges(
  '3A 41-5A 5F 61-7A C0-D6 D8-F6 F8-2FF 370-37D 37F-1FFF 200C-200D ' +
  '2070-218F 2C00-2FEF 3001-D7FF F900-FDCF FDF0-FFFD 10000-EFFFF'
);

const NAME_CHARS = [
  ...NAME_START_CHARS,
  ...parseRanges('2D-2E 30-39 B7 300-36F 203F-2040')
];

const SPACE_CHARS = parseRanges('9-A D 20');

const MULTI_CHAR_ESCAPES = {
  s: renderRanges(SPACE_CHARS),
  S: renderRanges(complement(SPACE_CHARS)),
  i: renderRanges(NAME_START_CHARS),
  I: renderRanges(complement(NAME_START_CHARS)),
  c: renderRanges(NAME_CHARS),
  C: renderRanges(complement(NAME_CHARS)),
  d: '\\p{Nd}',
  D: '\\P{Nd}',

  // all characters except punctuation, separators and other characters
  w: '\\p{L}\\p{M}\\p{N}\\p{S}',
  W: '\\p{P}\\p{Z}\\p{C}'
};

/**
 * Compile an XPath regular expression to a JavaScript one.
 *
 * @throws {RegexError} on invalid pattern or flags
 */
function compile(pattern: string, flags: string, extraFlags = '', name = 'pattern'): RegExp {

  if (!FLAGS_PATTERN.test(flags)) {
    throw new RegexError('expects valid flags, got {flags}', { flags });
  }

  // with <q> the pattern is literal and only <i> has an effect
  const literal = flags.includes('q');

  const jsFlags = [
    'u',
    flags.includes('i') ? 'i' : '',
    !literal && flags.includes('m') ? 'm' : '',
    !literal && flags.includes('s') ? 's' : '',
    extraFlags
  ].join('');

  try {
    const source = literal
      ? pattern.replace(LITERAL_PATTERN, '\\$&')
      : translate(flags.includes('x') ? stripWhitespace(pattern) : pattern, flags.includes('s'));

    return new RegExp(source, jsFlags);
  } catch (_err) {
    throw new RegexError(`expects a valid pattern, got {${ name }}`, {
      [ name ]: pattern
    });
  }
}

/**
 * Remove whitespace outside of character classes (<x> flag),
 * including whitespace between a backslash and the escaped character.
 */
function stripWhitespace(pattern: string) {

  let result = '';
  let depth = 0;
  let escaped = false;

  for (const char of pattern) {

    if (depth === 0 && WHITESPACE_PATTERN.test(char)) {
      continue;
    }

    result += char;

    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '[') {
      depth++;
    } else if (char === ']' && depth > 0) {
      depth--;
    }
  }

  return result;
}

/**
 * Translate an XPath regular expression to JavaScript (unicode mode)
 * source, rejecting constructs XPath does not support.
 *
 * Syntax that has the same meaning in both, such as quantifiers,
 * is passed through for the JavaScript engine to validate.
 */
function translate(pattern: string, dotAll: boolean) {

  let index = 0;

  // capturing groups opened so far, and those already closed
  let groupCount = 0;
  const openGroups: number[] = [];
  const closedGroups = new Set<number>();

  let source = '';

  while (index < pattern.length) {
    const char = pattern[index];

    if (char === '\\') {
      source += escapeAtom();
    } else if (char === '[') {
      source += charClass();
    } else if (char === '(') {

      if (pattern[index + 1] === '?') {

        if (pattern[index + 2] !== ':') {
          throw new Error('unsupported group (?');
        }

        openGroups.push(0);
        source += '(?:';
        index += 3;
      } else {
        openGroups.push(++groupCount);
        source += '(';
        index++;
      }
    } else if (char === ')') {
      closedGroups.add(openGroups.pop());
      source += ')';
      index++;
    } else if (char === '.' && !dotAll) {

      // matches line terminators other than \n and \r, too
      source += '[^\\n\\r]';
      index++;
    } else {
      source += char;
      index++;
    }
  }

  return source;

  function escapeAtom() {
    const next = pattern[index + 1];

    if (next && DIGIT_PATTERN.test(next) && next !== '0') {
      return backReference();
    }

    const atom = escape(false);

    return atom.codePoint === undefined ? `[${ atom.source }]` : atom.source;
  }

  /**
   * `\N`: further digits belong to the reference only
   * as long as that many groups have been opened before.
   */
  function backReference() {
    let group = Number(pattern[index + 1]);

    index += 2;

    while (
      index < pattern.length &&
      DIGIT_PATTERN.test(pattern[index]) &&
      group * 10 + Number(pattern[index]) <= groupCount
    ) {
      group = group * 10 + Number(pattern[index]);
      index++;
    }

    if (!closedGroups.has(group)) {
      throw new Error(`invalid back-reference \\${ group }`);
    }

    // isolate from digits that follow
    return `(?:\\${ group })`;
  }

  function escape(inClass: boolean): ClassAtom {
    const next = pattern[index + 1];

    if (next === undefined) {
      throw new Error('trailing backslash');
    }

    if (next === 'p' || next === 'P') {
      const end = pattern.indexOf('}', index);

      if (pattern[index + 2] !== '{' || end === -1) {
        throw new Error(`invalid escape \\${ next }`);
      }

      const name = pattern.slice(index + 3, end);

      index = end + 1;

      return { source: property(name, next === 'P') };
    }

    index += 2;

    if (next in MULTI_CHAR_ESCAPES) {
      return { source: MULTI_CHAR_ESCAPES[next] };
    }

    if (next in CONTROL_ESCAPES) {
      return {
        codePoint: { n: 0x0A, r: 0x0D, t: 0x09 }[next],
        source: CONTROL_ESCAPES[next]
      };
    }

    if (SINGLE_CHAR_ESCAPES.includes(next)) {
      return {
        codePoint: next.charCodeAt(0),

        // `\-` is an invalid escape outside of classes in unicode mode
        source: next === '-' && !inClass ? '-' : `\\${ next }`
      };
    }

    throw new Error(`invalid escape \\${ next }`);
  }

  /**
   * A character class, possibly with a subtraction: `[a-z-[aeiou]]`.
   */
  function charClass(): string {

    // skip [
    index++;

    const negated = pattern[index] === '^';

    if (negated) {
      index++;
    }

    let body = '';
    let subtraction: string = null;

    for (;;) {
      const char = pattern[index];

      if (char === undefined) {
        throw new Error('unterminated character class');
      }

      if (char === ']') {

        if (!body) {
          throw new Error('empty character class');
        }

        index++;
        break;
      }

      if (subtraction) {
        throw new Error('character class subtraction must be last');
      }

      if (char === '-' && pattern[index + 1] === '[') {

        if (!body) {
          throw new Error('empty character class');
        }

        index++;
        subtraction = charClass();
        continue;
      }

      if (char === '[') {
        throw new Error('unescaped [ in character class');
      }

      const start = classAtom();

      if (!isRangeDash()) {
        body += start.source;
        continue;
      }

      // skip -
      index++;

      const end = classAtom();

      if (start.codePoint === undefined || end.codePoint === undefined) {
        throw new Error('invalid character range');
      }

      if (end.codePoint < start.codePoint) {
        throw new Error('character range out of order');
      }

      body += `${ start.source }-${ end.source }`;
    }

    const cls = `[${ negated ? '^' : '' }${ body }]`;

    return subtraction ? `(?:(?!${ subtraction })${ cls })` : cls;
  }

  /**
   * Whether a `-` follows that forms a range, rather than
   * ending the class or starting a subtraction.
   */
  function isRangeDash() {
    const next = pattern[index + 1];

    return pattern[index] === '-' && next !== undefined && next !== ']' && next !== '[';
  }

  function classAtom(): ClassAtom {

    if (pattern[index] === '\\') {
      return escape(true);
    }

    const codePoint = pattern.codePointAt(index);
    const char = String.fromCodePoint(codePoint);

    index += char.length;

    return {
      codePoint,
      source: char === '-' || char === '^' ? `\\${ char }` : char
    };
  }
}

/**
 * Translate a `\p{...}` or `\P{...}` escape to class source.
 */
function property(name: string, negated: boolean) {

  if (name.startsWith('Is')) {
    const block = BLOCKS.get(name.slice(2));

    if (!block) {
      throw new Error(`unknown block ${ name }`);
    }

    const ranges = parseRanges(block);

    return renderRanges(negated ? complement(ranges) : ranges);
  }

  if (!CATEGORIES.has(name)) {
    throw new Error(`unknown category ${ name }`);
  }

  return `\\${ negated ? 'P' : 'p' }{${ name }}`;
}

/**
 * Translate an XPath replacement string to a replacer function:
 * `$N` refers to a captured group, `\$` and `\\` are literal.
 */
function createReplacer(replacement: string, groups: number) {

  // literal strings and group numbers
  const parts: (string | number)[] = [];

  let literal = '';

  for (let index = 0; index < replacement.length; index++) {
    const char = replacement[index];

    if (char === '\\') {
      const next = replacement[index + 1];

      if (next !== '\\' && next !== '$') {
        throw invalidReplacement(replacement);
      }

      literal += next;
      index++;
      continue;
    }

    if (char !== '$') {
      literal += char;
      continue;
    }

    let digits = /^[0-9]*/.exec(replacement.slice(index + 1))[0];

    if (!digits) {
      throw invalidReplacement(replacement);
    }

    index += digits.length;

    // a reference beyond the groups (and beyond $9) takes
    // fewer digits, the remaining ones are literal
    let suffix = '';

    while (Number(digits) > groups && Number(digits) > 9) {
      suffix = digits.slice(-1) + suffix;
      digits = digits.slice(0, -1);
    }

    parts.push(literal, Number(digits));

    literal = suffix;
  }

  parts.push(literal);

  return (match: string, ...captures: unknown[]) => parts.map(part => {

    if (typeof part === 'string') {
      return part;
    }

    if (part === 0) {
      return match;
    }

    return part <= groups ? (captures[part - 1] ?? '') : '';
  }).join('');
}

function invalidReplacement(replacement: string) {
  return new RegexError('expects a valid replacement, got {replacement}', { replacement });
}

function nonGlobal(regexp: RegExp) {
  return new RegExp(regexp.source, regexp.flags.replace('g', ''));
}

function countGroups(regexp: RegExp) {
  return new RegExp(`${ regexp.source }|`, regexp.flags.replace('g', '')).exec('').length - 1;
}


// character ranges ///////////////

function parseRanges(spec: string): Range[] {
  return spec.split(' ').map(range => {
    const [ start, end = start ] = range.split('-').map(hex => parseInt(hex, 16));

    return [ start, end ];
  });
}

function complement(ranges: Range[]): Range[] {

  const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);

  const result: Range[] = [];

  let next = 0;

  for (const [ start, end ] of sorted) {

    if (start > next) {
      result.push([ next, start - 1 ]);
    }

    next = Math.max(next, end + 1);
  }

  if (next <= MAX_CODE_POINT) {
    result.push([ next, MAX_CODE_POINT ]);
  }

  return result;
}

function renderRanges(ranges: Range[]) {
  return ranges.map(([ start, end ]) => {
    return start === end ? codePoint(start) : `${ codePoint(start) }-${ codePoint(end) }`;
  }).join('');
}

function codePoint(value: number) {
  return `\\u{${ value.toString(16) }}`;
}
