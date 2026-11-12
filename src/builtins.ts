import {
  isType,
  isArray,
  equals,
  isString,
  isNumber,
  getType,
  typeCast,
  isDate,
  isTime,
  isDateTime,
  isDuration
} from './types.js';

import {
  before,
  meets,
  includes as includesRange
} from './range.js';

import {
  invalidArguments,
  isInvocationFailure,
  parseParameterNames
} from './function.js';

import {
  getFromContext,
  has,
  isNotImplemented,
  notImplemented
} from './utils.js';

import {
  duration,
  parseDate,
  parseTime,
  parseDateTime,
  now,
  today,
  dateFrom,
  timeFrom,
  dateOf,
  timeOf,
  timeOfDate,
  combine,
  yearsAndMonthsDuration,
  absDuration,
  isZoned,
  toComparable
} from './temporal.js';


const names = [

  // 10.3.4.1 Conversion functions
  'date and time',
  'time',
  'date',
  'number',
  'string',
  'duration',
  'years and months duration',

  // 10.3.4.2 Boolean function
  'not',

  // 10.3.4.3 String functions
  'substring',
  'string length',
  'upper case',
  'lower case',
  'substring before',
  'substring after',
  'replace',
  'contains',
  'matches',
  'starts with',
  'ends with',
  'split',
  'string join',

  // 10.3.4.4 List functions
  'list contains',
  'list replace',
  'count',
  'min',
  'max',
  'sum',
  'mean',
  'all',
  'any',
  'sublist',
  'append',
  'concatenate',
  'insert before',
  'remove',
  'reverse',
  'index of',
  'union',
  'distinct values',
  'flatten',
  'product',
  'median',
  'stddev',
  'mode',

  // 10.3.4.5 Numeric functions
  'decimal',
  'floor',
  'ceiling',
  'abs',
  'modulo',
  'sqrt',
  'log',
  'exp',
  'odd',
  'even',

  // 10.3.4.6 Date and time functions
  'is',

  // 10.3.4.7 Range Functions
  'before',
  'after',
  'meets',
  'met by',
  'overlaps',
  'overlaps before',
  'overlaps after',
  'finishes',
  'finished by',
  'includes',
  'during',
  'starts',
  'started by',
  'coincides',

  // 10.3.4.8 Temporal built-in functions
  'day of year',
  'day of week',
  'month of year',
  'week of year',

  // 10.3.4.9 Sort
  'sort',
  'list',
  'precedes',

  // 10.3.4.10 Context function
  'get value',
  'get entries',
  'context',
  'context merge',
  'context put'
];


// 10.3.4 Built-in functions

const builtins = {

  // 10.3.4.1 Conversion functions

  'number': fn(function(from, groupingSeparator, decimalSeparator) {

    // must always provide three arguments
    if (arguments.length !== 3) {
      return null;
    }

    const original = from;

    if (groupingSeparator) {
      from = from.split(groupingSeparator).join('');
    }

    if (decimalSeparator && decimalSeparator !== '.') {
      from = from.split('.').join('#').split(decimalSeparator).join('.');
    }

    const number = +from;

    if (isNaN(number)) {
      return invalidArguments('number(from) expects a numeric string, got {from}', {
        from: original
      });
    }

    return number;
  }, [ 'string', 'string?', 'string?' ], [ 'from', 'grouping separator', 'decimal separator' ]),

  'string': fn(function(from) {
    if (from === null) {
      return null;
    }

    return toString(from);
  }, [ 'any' ], [ 'from' ]),

  // date(from) => date string
  // date(from) => date and time
  // date(year, month, day)
  'date': fn(function(year, month, day, from) {

    if (!from && !isNumber(year)) {
      from = year;
      year = null;
    }

    let d;

    if (isString(from)) {
      d = parseDate(from);
    } else if (isDate(from)) {
      d = from;
    } else if (isDateTime(from)) {
      d = dateOf(from);
    }

    if (isNumber(year)) {

      const error =
        guard(from == null, 'date(year, month, day) does not accept a <from> argument') ||
        guard(isNumber(month) && isNumber(day), 'date(year, month, day) expects <month> and <day> to be numbers');

      if (error) {
        return error;
      }

      d = dateFrom(year, month, day);

      if (!d) {
        return invalidArguments('{year}, {month}, {day} is not a valid date', {
          year,
          month,
          day
        });
      }
    }

    if (d) {
      return d;
    }

    return invalidArguments('date({from}) is not a valid date', { from });
  }, [ 'any?', 'number?', 'number?', 'any?' ], [ 'year', 'month', 'day', 'from' ]),

  // date and time(from) => date time string
  // date and time(date, time)
  'date and time': fn(function(d, time, from) {

    const dateArg = d;

    let dt;

    if ((isDate(d) || isDateTime(d)) && isTime(time)) {
      dt = combine(d, time);
    }

    if (isString(d)) {
      from = d;
      d = null;
    }

    if (isString(from)) {
      dt = parseDateTime(from);
    }

    if (dt) {
      return dt;
    }

    return invalidArguments('date and time({from}) is not a valid date time', {
      from: isString(from) ? from : dateArg
    });
  }, [ 'any?', 'time?', 'string?' ], [ 'date', 'time', 'from' ]),

  // time(from) => time string
  // time(from) => time, date and time
  // time(hour, minute, second, offset?) => ...
  'time': fn(function(hour, minute, second, offset, from) {

    let t;

    if (isString(hour) || isDate(hour) || isDateTime(hour) || isTime(hour)) {
      from = hour;
      hour = null;
    }

    if (isString(from) && from) {
      t = parseTime(from);
    }

    if (isTime(from)) {
      t = from;
    }

    if (isDateTime(from)) {
      t = timeOf(from);
    }

    // a date converts to its midnight (UTC) time
    if (isDate(from)) {
      t = timeOfDate(from);
    }

    if (isNumber(hour)) {

      const error =
        guard(isNumber(minute) && isNumber(second), 'time(hour, minute, second) expects <minute> and <second> to be numbers') ||
        guard(offset == null || isDuration(offset), 'time(hour, minute, second, offset) expects <offset> to be a duration');

      if (error) {
        return error;
      }

      t = timeFrom(hour, minute, second, offset);

      if (!t) {
        return invalidArguments('{hour}, {minute}, {second} is not a valid time', {
          hour,
          minute,
          second
        });
      }
    }

    if (t) {
      return t;
    }

    return invalidArguments('time({from}) is not a valid time', { from: from ?? hour });
  }, [ 'any?', 'number?', 'number?', 'any?', 'any?' ], [ 'hour', 'minute', 'second', 'offset', 'from' ]),

  'duration': fn(function(from) {

    const d = duration(from);

    if (!d) {
      return invalidArguments('duration({from}) is not a valid duration', { from });
    }

    return d;
  }, [ 'string' ], [ 'from' ]),

  'years and months duration': fn(function(from, to) {
    return yearsAndMonthsDuration(from, to);
  }, [ 'date', 'date' ], [ 'from', 'to' ]),

  '@': fn(function(string) {

    let t;

    if (DURATION_START_PATTERN.test(string)) {
      t = duration(string);
    }

    else if (TIME_START_PATTERN.test(string)) {
      t = parseTime(string);
    }

    else if (string.includes('T')) {
      t = parseDateTime(string);
    }

    else {
      t = parseDate(string);
    }

    if (!t) {
      return invalidArguments('@"{string}" is not a valid temporal literal', { string });
    }

    return t;
  }, [ 'string' ]),

  'now': fn(function() {
    return now();
  }, [], []),

  'today': fn(function() {
    return today();
  }, [], []),

  // 10.3.4.2 Boolean function
  'not': fn(function(negand) {
    return isType(negand, 'boolean') ? !negand : null;
  }, [ 'any' ], [ 'negand' ]),

  // 10.3.4.3 String functions
  'substring': fn(function(string, start, length) {

    const _start = (start < 0 ? string.length + start : start - 1);

    const arr = Array.from(string);

    return (
      typeof length !== 'undefined'
        ? arr.slice(_start, _start + length)
        : arr.slice(_start)
    ).join('');
  }, [ 'string', 'number', 'number?' ], [ 'string', 'start position', 'length' ]),

  'string length': fn(function(string) {
    return countSymbols(string);
  }, [ 'string' ], [ 'string' ]),

  'upper case': fn(function(string) {
    return string.toUpperCase();
  }, [ 'string' ], [ 'string' ]),

  'lower case': fn(function(string) {
    return string.toLowerCase();
  }, [ 'string' ], [ 'string' ]),

  'substring before': fn(function(string, match) {

    const index = string.indexOf(match);

    if (index === -1) {
      return '';
    }

    return string.substring(0, index);
  }, [ 'string', 'string' ], [ 'string', 'match' ]),

  'substring after': fn(function(string, match) {

    const index = string.indexOf(match);

    if (index === -1) {
      return '';
    }

    return string.substring(index + match.length);
  }, [ 'string', 'string' ], [ 'string', 'match' ]),

  'replace': fn(function(input, pattern, replacement, flags) {
    const regexp = createRegexp(pattern, flags || '', 'g');

    if (!regexp) {
      return invalidArguments('replace(input, pattern, replacement) expects a valid pattern, got {pattern}', {
        pattern
      });
    }

    return input.replace(regexp, replacement.replace(/\$0/g, '$$&'));
  }, [ 'string', 'string', 'string', 'string?' ], [ 'input', 'pattern', 'replacement', 'flags' ]),

  'contains': fn(function(string, match) {
    return string.includes(match);
  }, [ 'string', 'string' ], [ 'string', 'match' ]),

  'matches': fn(function(input, pattern, flags) {
    const regexp = createRegexp(pattern, flags || '', '');

    if (!regexp) {
      return invalidArguments('matches(input, pattern) expects a valid pattern, got {pattern}', {
        pattern
      });
    }

    return regexp.test(input);
  }, [ 'string', 'string', 'string?' ], [ 'input', 'pattern', 'flags' ]),

  'starts with': fn(function(string, match) {
    return string.startsWith(match);
  }, [ 'string', 'string' ], [ 'string', 'match' ]),

  'ends with': fn(function(string, match) {
    return string.endsWith(match);
  }, [ 'string', 'string' ], [ 'string', 'match' ]),

  'split': fn(function(string, delimiter) {
    const regexp = createRegexp(delimiter, '', '');

    if (!regexp) {
      return invalidArguments('split(string, delimiter) expects a valid pattern, got {delimiter}', {
        delimiter
      });
    }

    return string.split(regexp);
  }, [ 'string', 'string' ], [ 'string', 'delimiter' ]),

  'string join': fn(function(list, delimiter) {

    const invalidItem = list.find(e => !isString(e) && e !== null);

    if (invalidItem !== undefined) {
      return invalidArguments('string join(list) expects a list of strings, got {item}', {
        item: invalidItem
      });
    }

    return list.filter(l => l !== null).join(delimiter || '');
  }, [ 'list', 'string?' ], [ 'list', 'delimiter' ]),

  // 10.3.4.4 List functions

  'list contains': fn(function(list, element) {
    return list.some(el => matches(el, element));
  }, [ 'list', 'any?' ], [ 'list', 'element' ]),

  // list replace(list, position, newItem)
  // list replace(list, match, newItem)
  'list replace': fn(function(list, position, newItem, match) {

    const matcher = position || match;

    if (![ 'number', 'function' ].includes(getType(matcher))) {
      return invalidArguments('list replace expects a numeric position or a match function, got {matcher}', {
        matcher
      });
    }

    return listReplace(list, position || match, newItem);
  }, [ 'list', 'any?', 'any', 'function?' ], [ 'list', 'position', 'newItem', 'match' ]),

  'count': fn(function(list) {
    return list.length;
  }, [ 'list' ], [ 'list' ]),

  'min': listFn(function(...list) {
    return list.reduce((min, el) => min === null ? el : Math.min(min, el), null);
  }, 'number', [ '...list' ]),

  'max': listFn(function(...list) {
    return list.reduce((max, el) => max === null ? el : Math.max(max, el), null);
  }, 'number', [ '...list' ]),

  'sum': listFn(function(...list) {
    return sum(list);
  }, 'number', [ '...list' ]),

  'mean': listFn(function(...list) {
    const s = sum(list);

    return s === null ? s : s / list.length;
  }, 'number', [ '...list' ]),

  'all': listFn(function(...list) {

    let nonBool = false;

    for (const o of list) {

      if (o === false) {
        return false;
      }

      if (typeof o !== 'boolean') {
        nonBool = true;
      }
    }

    return nonBool ? null : true;

  }, 'any?', [ '...list' ]),

  'any': listFn(function(...list) {

    let nonBool = false;

    for (const o of list) {

      if (o === true) {
        return true;
      }

      if (typeof o !== 'boolean') {
        nonBool = true;
      }
    }

    return nonBool ? null : false;
  }, 'any?', [ '...list' ]),

  'sublist': fn(function(list, start, length) {

    const _start = (start < 0 ? list.length + start : start - 1);

    return (
      typeof length !== 'undefined'
        ? list.slice(_start, _start + length)
        : list.slice(_start)
    );

  }, [ 'list', 'number', 'number?' ], [ 'list', 'start', 'length' ]),

  'append': fn(function(list, ...items) {
    return list.concat(items);
  }, [ 'list', 'any?' ], [ 'list', '...item' ]),

  'concatenate': fn(function(...list) {

    const result = [];

    for (const arg of list) {
      if (isArray(arg)) {
        for (const item of arg) {
          result.push(item);
        }
      } else {
        result.push(arg);
      }
    }

    return result;

  }, [ 'any' ], [ '...list' ]),

  'insert before': fn(function(list, position, newItem) {

    // single-copy equivalent of
    // list.slice(0, position - 1).concat([ newItem ], list.slice(position - 1))
    const len = list.length;

    let p = position - 1;

    if (p < 0) {
      p = Math.max(0, len + p);
    } else if (p > len) {
      p = len;
    }

    const result = new Array(len + 1);

    for (let i = 0; i < p; i++) {
      result[i] = list[i];
    }

    result[p] = newItem;

    for (let i = p; i < len; i++) {
      result[i + 1] = list[i];
    }

    return result;
  }, [ 'list', 'number', 'any?' ], [ 'list', 'position', 'newItem' ]),

  'remove': fn(function(list, position) {

    // single-copy equivalent of
    // list.slice(0, position - 1).concat(list.slice(position))
    const len = list.length;

    const head = Math.min(Math.max(position - 1, -len), len);
    const tail = Math.min(Math.max(position, -len), len);

    const a = head < 0 ? len + head : head;
    const b = tail < 0 ? len + tail : tail;

    const result = new Array(a + (len - b));

    for (let i = 0; i < a; i++) {
      result[i] = list[i];
    }

    for (let i = b; i < len; i++) {
      result[a + (i - b)] = list[i];
    }

    return result;
  }, [ 'list', 'number' ], [ 'list', 'position' ]),

  'reverse': fn(function(list) {
    return list.slice().reverse();
  }, [ 'list' ], [ 'list' ]),

  'index of': fn(function(list, match) {

    return list.reduce(function(result, element, index) {

      if (matches(element, match)) {
        result.push(index + 1);
      }

      return result;
    }, []);
  }, [ 'list', 'any' ], [ 'list', 'match' ]),

  'union': listFn(function(...lists) {

    return distinctLists(lists);

  }, 'list', [ '...list' ]),

  'distinct values': fn(function(list) {
    return distinctLists([ list ]);
  }, [ 'list' ], [ 'list' ]),

  'flatten': fn(function(list) {
    return flatten(list);
  }, [ 'list' ], [ 'list' ]),

  'product': listFn(function(...list) {

    if (list.length === 0) {
      return null;
    }

    return list.reduce((result, n) => {
      return result * n;
    }, 1);
  }, 'number', [ '...list' ]),

  'median': listFn(function(...list) {

    if (list.length === 0) {
      return null;
    }

    return median(list);
  }, 'number', [ '...list' ]),

  'stddev': listFn(function(...list) {

    if (list.length < 2) {
      return null;
    }

    return stddev(list);
  }, 'number', [ '...list' ]),

  'mode': listFn(function(...list) {
    return mode(list);
  }, 'number', [ '...list' ]),


  // 10.3.4.5 Numeric functions
  'decimal': fn(function(n, scale) {
    if (n === null || scale === null) return null;

    // a fractional scale is truncated to an integer
    return roundWithScale('decimal', n, Math.trunc(scale), 'HALF_EVEN');
  }, [ 'number', 'number' ], [ 'n', 'scale' ]),

  'floor': fn(function(n, scale = 0) {
    if (n === null || scale === null) return null;
    return roundWithScale('floor', n, scale, 'FLOOR');
  }, [ 'number', 'number?' ], [ 'n', 'scale' ]),

  'ceiling': fn(function(n, scale = 0) {
    if (n === null || scale === null) return null;
    return roundWithScale('ceiling', n, scale, 'CEILING');
  }, [ 'number', 'number?' ], [ 'n', 'scale' ]),

  'abs': fn(function(n) {

    if (isNumber(n)) {
      return Math.abs(n);
    }

    if (isDuration(n)) {
      return absDuration(n);
    }

    if (n === null) {
      return null;
    }

    return invalidArguments('abs(n) expects a number or duration, got {n}', {
      n
    });
  }, [ 'any' ], [ 'n' ]),

  'round up': fn(function(n, scale) {
    if (n === null || scale === null) return null;
    return roundWithScale('round up', n, scale, 'UP');
  }, [ 'number', 'number' ], [ 'n', 'scale' ]),

  'round down': fn(function(n, scale) {
    if (n === null || scale === null) return null;
    return roundWithScale('round down', n, scale, 'DOWN');
  }, [ 'number', 'number' ], [ 'n', 'scale' ]),

  'round half up': fn(function(n, scale) {
    if (n === null || scale === null) return null;
    return roundWithScale('round half up', n, scale, 'HALF_UP');
  }, [ 'number', 'number' ], [ 'n', 'scale' ]),

  'round half down': fn(function(n, scale) {
    if (n === null || scale === null) return null;
    return roundWithScale('round half down', n, scale, 'HALF_DOWN');
  }, [ 'number', 'number' ], [ 'n', 'scale' ]),

  'modulo': fn(function(dividend, divisor) {

    if (!divisor) {
      return invalidArguments('modulo(dividend, divisor) does not accept {divisor} as a divisor', {
        divisor
      });
    }

    const adjust = 1000000000;

    // cf. https://dustinpfister.github.io/2017/09/02/js-whats-wrong-with-modulo/
    //
    // need to round here as using this custom modulo
    // variant is prone to rounding errors
    return Math.round((dividend % divisor + divisor) % divisor * adjust) / adjust;
  }, [ 'number', 'number' ], [ 'dividend', 'divisor' ]),

  'sqrt': fn(function(number) {

    if (number < 0) {
      return invalidArguments('sqrt(number) expects a non-negative number, got {number}', {
        number
      });
    }

    return Math.sqrt(number);
  }, [ 'number' ], [ 'number' ]),

  'log': fn(function(number) {
    if (number <= 0) {
      return invalidArguments('log(number) expects a positive number, got {number}', {
        number
      });
    }

    return Math.log(number);
  }, [ 'number' ], [ 'number' ]),

  'exp': fn(function(number) {
    return Math.exp(number);
  }, [ 'number' ], [ 'number' ]),

  'odd': fn(function(number) {
    return Math.abs(number) % 2 === 1;
  }, [ 'number' ], [ 'number' ]),

  'even': fn(function(number) {
    return Math.abs(number) % 2 === 0;
  }, [ 'number' ], [ 'number' ]),


  // 10.3.4.6 Date and time functions

  'is': fn(function(value1, value2) {

    if (typeof value1 === 'undefined' || typeof value2 === 'undefined') {
      return false;
    }

    return equals(value1, value2, true);
  }, [ 'any?', 'any?' ], [ 'value1', 'value2' ]),

  // 10.3.4.7 Range Functions

  'before': fn(function(a, b) {
    return before(a, b);
  }, [ 'any', 'any' ], [ 'a', 'b' ]),

  'after': fn(function(a, b) {
    return before(b, a);
  }, [ 'any', 'any' ], [ 'a', 'b' ]),

  'meets': fn(function(range1, range2) {
    return meets(range1, range2);
  }, [ 'range', 'range' ], [ 'range1', 'range2' ]),

  'met by': fn(function(range1, range2) {
    return meets(range2, range1);
  }, [ 'range', 'range' ], [ 'range1', 'range2' ]),

  'overlaps': fn(function(range1, range2) {
    return !before(range1, range2) && !before(range2, range1);
  }, [ 'range', 'range' ], [ 'range1', 'range2' ]),

  'overlaps before': fn(function() {
    throw notImplemented('overlaps before');
  }, [ 'any?' ]),

  'overlaps after': fn(function() {
    throw notImplemented('overlaps after');
  }, [ 'any?' ]),

  'finishes': fn(function() {
    throw notImplemented('finishes');
  }, [ 'any?' ]),

  'finished by': fn(function() {
    throw notImplemented('finished by');
  }, [ 'any?' ]),

  'includes': fn(function(range, value) {
    return includesRange(range, value);
  }, [ 'range', 'any' ], [ 'range', 'value' ]),

  'during': fn(function() {
    throw notImplemented('during');
  }, [ 'any?' ]),

  'starts': fn(function() {
    throw notImplemented('starts');
  }, [ 'any?' ]),

  'started by': fn(function() {
    throw notImplemented('started by');
  }, [ 'any?' ]),

  'coincides': fn(function() {
    throw notImplemented('coincides');
  }, [ 'any?' ]),


  // 10.3.4.8 Temporal built-in functions

  'day of year': fn(function(date) {
    return date.value.dayOfYear;
  }, [ 'date time' ], [ 'date' ]),

  'day of week': fn(function(date) {
    return WEEKDAY_NAMES[date.value.dayOfWeek - 1];
  }, [ 'date time' ], [ 'date' ]),

  'month of year': fn(function(date) {
    return MONTH_NAMES[date.value.month - 1];
  }, [ 'date time' ], [ 'date' ]),

  'week of year': fn(function(date) {
    return date.value.weekOfYear;
  }, [ 'date time' ], [ 'date' ]),


  // 10.3.4.9 Sort

  'sort': fn(function(list, precedes) {

    // fast path: positional two-parameter functions can be invoked
    // directly, skipping FeelFunction#invoke argument binding overhead
    // on every comparison
    const compare = precedes.parameterNames.length === 2
      ? (a, b) => precedes.fn(a, b) ? -1 : 1
      : (a, b) => precedes.invoke([ a, b ]) ? -1 : 1;

    return Array.from(list).sort(compare);
  }, [ 'list', 'function' ], [ 'list', 'precedes' ]),


  // 10.3.4.10 Context function

  'get value': fn(function(m, key) {
    const value = getFromContext(key, m);
    return value != undefined ? value : null;
  }, [ 'context', 'string' ], [ 'm', 'key' ]),

  'get entries': fn(function(m) {

    if (arguments.length !== 1) {
      return null;
    }

    if (Array.isArray(m)) {
      return null;
    }

    return Object.entries(m).map(([ key, value ]) => ({ key, value }));
  }, [ 'context' ], [ 'm' ]),

  'context': listFn(function(...entries) {

    const context = {};

    for (const entry of entries) {

      if (![ 'key', 'value' ].every(e => e in entry)) {
        return invalidArguments('context(entries) expects each entry to have a key and value, got {entry}', {
          entry
        });
      }

      const key = entry.key;

      if (key === null) {
        return invalidArguments('context(entries) does not accept a null key');
      }

      if (has(context, key)) {
        return invalidArguments('context(entries) expects unique keys, got {key}', {
          key
        });
      }

      context[key] = entry.value;
    }

    return context;
  }, 'context', [ '...entries' ]),

  'context merge': listFn(function(...contexts) {
    return Object.assign({}, ...contexts);
  }, 'context', [ '...contexts' ]),

  'context put': fn(function(context, keys, value, key) {

    if (typeof keys === 'undefined' && typeof key === 'undefined') {
      return invalidArguments('context put(context, value) expects a key or keys');
    }

    return contextPut(context, keys || [ key ], value);
  }, [ 'context', 'list?', 'any', 'string?' ], [ 'context', 'keys', 'value', 'key' ])

};

export {
  names,
  builtins
};

/**
 * @param {Object} context
 * @param {string[]} keys
 * @param {any} value
 */
function contextPut(context, keys, value) {
  const [ key, ...remainingKeys ] = keys;

  if (getType(key) !== 'string') {
    return invalidArguments('context put expects a string key, got {key}', {
      key
    });
  }

  if (getType(context) === 'nil') {
    return invalidArguments('context put expects an existing context, got {context}', {
      context
    });
  }

  if (remainingKeys.length) {
    value = contextPut(context[key], remainingKeys, value);

    if (isInvocationFailure(value)) {
      return value;
    }
  }

  return {
    ...context,
    [key]: value
  };
}

function matches(a, b) {
  return a === b;
}

const FALSE = {};

const DURATION_START_PATTERN = /^-?P/;

const TIME_START_PATTERN = /^\d{1,2}:\d{1,2}:\d{1,2}/;

const NON_WORD_PATTERN = /\W/;

const SUPPORTED_FLAGS_PATTERN = /[smix]/g;

const EXTENDED_FLAG_PATTERN = /x/;

function createArgTester(arg) {
  const optional = arg.endsWith('?');

  const type = optional ? arg.substring(0, arg.length - 1) : arg;

  return function(obj) {

    const arr = Array.isArray(obj);

    if (type === 'list') {
      if (arr || optional && typeof obj === 'undefined') {
        return obj;
      } else if (typeof obj === 'undefined') {

        // reject a missing required list argument
        return FALSE;
      } else {

        // implicit conversion obj => [ obj ]
        return obj === null ? FALSE : [ obj ];
      }
    }

    if (type !== 'any' && arr && obj.length === 1) {

      // implicit conversion [ obj ] => obj
      obj = obj[0];
    }

    const objType = getType(obj);

    if (type === 'any' || type === objType) {
      return optional ? obj : typeof obj !== 'undefined' ? obj : FALSE;
    }

    if (objType === 'nil') {
      return (optional ? obj : FALSE);
    }

    return typeCast(obj, type) || FALSE;
  };
}

function createArgsValidator(argDefinitions) {

  const tests = argDefinitions.map(createArgTester);

  return function(args) {

    const result = [];

    // validate provided args; pad and validate missing trailing args
    // (without mutating the caller's array)
    const length = Math.max(args.length, argDefinitions.length);

    for (let index = 0; index < length; index++) {

      const test = tests[index];

      const conversion = test ? test(args[index]) : args[index];

      if (conversion === FALSE) {
        return false;
      }

      result.push(conversion);
    }

    return result;

  };
}

/**
 * @param {Function} fnDefinition
 * @param {string} type
 * @param {string[]} [parameterNames]
 *
 * @return {Function}
 */
function listFn(fnDefinition, type, parameterNames = null) {

  const tester = createArgTester(type);

  const wrappedFn = function(...args) {

    if (args.length === 0) {
      return null;
    }

    // unwrap first arg
    if (Array.isArray(args[0]) && args.length === 1) {
      args = args[0];
    }

    if (!args.every(arg => tester(arg) !== FALSE)) {
      return null;
    }

    return fnDefinition(...args);
  };

  wrappedFn.$args = parameterNames || parseParameterNames(fnDefinition);

  return wrappedFn;
}

/**
 * Return an {@link invalidArguments} signal unless the condition holds,
 * so builtins can express argument validation as a flat guard chain
 * (`guard(...) || guard(...)`), short-circuiting on the first failure.
 *
 * @param {boolean} condition
 * @param {string} template
 * @param {Record<string, unknown>} [values]
 *
 * @return {import('./function.js').InvocationFailure | null}
 */
function guard(condition, template, values = {}) {
  return condition ? null : invalidArguments(template, values);
}

/**
 * @param {Function} fnDefinition
 * @param {string[]} argDefinitions
 * @param {string[]} [parameterNames]
 *
 * @return {Function}
 */
function fn(fnDefinition, argDefinitions, parameterNames = null) {
  const checkArgs = createArgsValidator(argDefinitions);

  parameterNames = parameterNames || parseParameterNames(fnDefinition);

  const wrappedFn = function(...args) {

    const convertedArgs = checkArgs(args);

    if (!convertedArgs) {
      return null;
    }

    return fnDefinition(...convertedArgs);
  };

  wrappedFn.$args = parameterNames;

  return wrappedFn;
}

function sum(list) {
  return list.reduce((sum, el) => sum === null ? el : sum + el, null);
}

/**
 * Deduplicate the concatenation of `lists`, preserving FEEL `equals`
 * semantics and first-occurrence order.
 *
 * @param {any[][]} lists
 *
 * @return {any[]}
 */
function distinctLists(lists) {

  // hash-bucket scalars and temporals for O(1) probes; complex values
  // (lists, contexts, ranges, durations) fall back to linear equals() scans
  const result = [];
  const seenScalars = new Set();
  const seenTemporals = new Set();
  const complex = [];

  const temporalKey = (e) => {
    const type = getType(e);

    if (type === 'date' || type === 'time' || type === 'date time') {
      return `${type}|${isZoned(e) ? 1 : 0}|${toComparable(e)}`;
    }

    return null;
  };

  for (const list of lists) {
    for (const e of list) {

      // NaN excluded: it is never equal to itself per equals() and
      // thus never deduplicated
      const scalar = (
        typeof e === 'number' && !Number.isNaN(e) ||
        typeof e === 'string' ||
        typeof e === 'boolean' ||
        e === null ||
        e === undefined
      );

      // complex values are probed against scalars, too: equals() unwraps
      // single-element lists, so [ 1 ] equals 1
      if (scalar) {
        if (seenScalars.has(e) || complex.some(c => equals(e, c))) {
          continue;
        }

        seenScalars.add(e);
        result.push(e);

        continue;
      }

      const key = temporalKey(e);

      if (key !== null) {
        if (seenTemporals.has(key) || complex.some(c => equals(e, c))) {
          continue;
        }

        seenTemporals.add(key);
        result.push(e);

        continue;
      }

      if (result.some(r => equals(e, r))) {
        continue;
      }

      complex.push(e);
      result.push(e);
    }
  }

  return result;
}

function flatten<T>(list: (T | T[])[]): T[] {

  const result: T[] = [];

  // explicit stack of [array, index] frames, deepest list on top
  const stack: [ (T | T[])[], number ][] = [ [ list, 0 ] ];

  while (stack.length) {
    const frame = stack[stack.length - 1];
    const [ items, index ] = frame;

    if (index >= items.length) {
      stack.pop();
      continue;
    }

    frame[1]++;

    const item = items[index];

    if (Array.isArray(item)) {
      stack.push([ item, 0 ]);
    } else if (item !== undefined) {
      result.push(item);
    }
  }

  return result;
}

function toKeyString(key) {
  if (typeof key === 'string' && NON_WORD_PATTERN.test(key)) {
    return toString(key, true);
  }

  return key;
}

function toDeepString(obj) {
  return toString(obj, true);
}

function escapeStr(str) {
  return str.replace(/("|\\)/g, '\\$1');
}

function toString(obj, wrap = false) {

  const type = getType(obj);

  if (type === 'nil') {
    return 'null';
  }

  if (type === 'string') {
    return wrap ? `"${ escapeStr(obj) }"` : obj;
  }

  if (type === 'boolean' || type === 'number') {
    return String(obj);
  }

  if (type === 'list') {
    return '[' + obj.map(toDeepString).join(', ') + ']';
  }

  if (type === 'context') {
    return '{' + Object.entries(obj).map(([ key, value ]) => {
      return toKeyString(key) + ': ' + toDeepString(value);
    }).join(', ') + '}';
  }

  if (type === 'duration') {
    return obj.toString();
  }

  if (type === 'date time') {
    return obj.toString();
  }

  if (type === 'date') {
    return obj.toString();
  }

  if (type === 'range') {
    return '<range>';
  }

  if (type === 'time') {
    return obj.toString();
  }

  if (type === 'function') {
    return '<function>';
  }

  throw notImplemented('string(' + type + ')');
}

function countSymbols(str) {

  // cf. https://mathiasbynens.be/notes/javascript-unicode
  return str.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '_').length;
}

type RoundingMode = 'UP' | 'DOWN' | 'CEILING' | 'FLOOR' | 'HALF_UP' | 'HALF_DOWN' | 'HALF_EVEN';

// scale range of IEEE 754 decimal128, cf. DMN 1.5, 10.3.4.5
const MIN_SCALE = -6111;
const MAX_SCALE = 6176;

/**
 * Round `n` to `scale` digits after the decimal point,
 * validating the scale first.
 *
 * @param {string} name
 * @param {number} n
 * @param {number} scale
 * @param {RoundingMode} mode
 *
 * @return {number|InvocationFailure}
 */
function roundWithScale(name: string, n: number, scale: number, mode: RoundingMode) {

  if (!Number.isInteger(scale) || scale < MIN_SCALE || scale > MAX_SCALE) {
    return invalidArguments(`${name}(n, scale) expects an integer scale in [${MIN_SCALE}..${MAX_SCALE}], got {scale}`, {
      scale
    });
  }

  return roundToScale(n, scale, mode);
}

/**
 * Round `n` to `scale` digits after the decimal point.
 *
 * Rounds the shortest decimal representation of `n`
 * (what `String(n)` yields) rather than its binary
 * floating point value, so that `1.005` rounds as written.
 *
 * Returns `n` unchanged if the rounded result cannot be
 * represented as a (finite) number.
 *
 * @param {number} n
 * @param {number} scale
 * @param {RoundingMode} mode
 *
 * @return {number}
 */
function roundToScale(n: number, scale: number, mode: RoundingMode) {

  if (n === 0) {
    return 0;
  }

  if (!Number.isFinite(n)) {
    return n;
  }

  const negative = n < 0;

  // n = digits * 10^exponent
  const [ mantissa, exp = '0' ] = String(Math.abs(n)).split('e');
  const [ integer, fraction = '' ] = mantissa.split('.');

  const digits = (integer + fraction).replace(/^0+/, '');
  const exponent = Number(exp) - fraction.length;

  // number of trailing digits to drop
  const drop = -exponent - scale;

  if (drop <= 0) {
    return n;
  }

  const keep = digits.length - drop;

  let kept = keep > 0 ? digits.slice(0, keep) : '0';

  // dropping more digits than there are leaves a
  // remainder below half of the rounding unit
  const dropped = keep >= 0 ? digits.slice(keep) : '0' + digits;

  if (/[1-9]/.test(dropped)) {

    // compare remainder to half of the rounding unit
    const half = dropped[0] > '5' ? 1 : dropped[0] < '5' ? -1 : /[1-9]/.test(dropped.slice(1)) ? 1 : 0;

    const increment = {
      'UP': true,
      'DOWN': false,
      'CEILING': !negative,
      'FLOOR': negative,
      'HALF_UP': half >= 0,
      'HALF_DOWN': half > 0,
      'HALF_EVEN': half > 0 || (half === 0 && Number(kept[kept.length - 1]) % 2 === 1)
    }[mode];

    if (increment) {
      kept = incrementDigits(kept);
    }
  }

  const result = Number(`${negative ? '-' : ''}${kept}e${-scale}`);

  if (!Number.isFinite(result)) {
    return n;
  }

  return result === 0 ? 0 : result;
}

/**
 * Add one to a non-negative integer given as a digit string.
 *
 * @param {string} digits
 *
 * @return {string}
 */
function incrementDigits(digits: string) {

  let i = digits.length - 1;

  while (i >= 0 && digits[i] === '9') {
    i--;
  }

  return (i < 0 ? '1' : digits.slice(0, i) + (Number(digits[i]) + 1)) + '0'.repeat(digits.length - i - 1);
}

// adapted from https://stackoverflow.com/a/53577159

function stddev(array) {
  const n = array.length;
  const mean = array.reduce((a, b) => a + b) / n;

  return Math.sqrt(
    array.map(
      x => Math.pow(x - mean, 2)
    ).reduce(
      (a, b) => a + b
    ) / (n - 1)
  );
}

function listReplace(list, matcher, newItem) {

  if (isNumber(matcher)) {
    return [ ...list.slice(0, matcher - 1), newItem, ...list.slice(matcher) ];
  }

  return list.map((item, _idx) => {

    if (matcher.invoke([ item, newItem ])) {
      return newItem;
    } else {
      return item;
    }
  });
}

function median(array) {
  const n = array.length;
  const sorted = array.slice().sort();

  const mid = n / 2 - 1;
  const index = Math.ceil(mid);

  // even
  if (mid === index) {
    return (sorted[index] + sorted[index + 1]) / 2;
  }

  // uneven
  return sorted[index];
}

function mode(array: number[]) {

  if (array.length < 2) {
    return array;
  }

  const buckets: Record<number, number> = {};

  for (const n of array) {
    buckets[n] = (buckets[n] || 0) + 1;
  }

  const sorted = Object.entries(buckets).sort((a, b) => b[1] - a[1]);

  return sorted.filter(s => s[1] === sorted[0][1]).map(e => +e[0]);
}

const WEEKDAY_NAMES = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Concatenates flags for a regular expression.
 *
 * Ensures that default flags are included without duplication, even if
 * user-specified flags overlap with the defaults.
 */
export function buildFlags(flags: string, defaultFlags: string) {

  const unsupportedFlags = flags.replace(SUPPORTED_FLAGS_PATTERN, '');

  if (unsupportedFlags) {
    throw new Error('illegal flags: ' + unsupportedFlags);
  }

  // we don't implement the <x> flag
  if (EXTENDED_FLAG_PATTERN.test(flags)) {
    throw notImplemented('matches <x> flag');
  }

  return flags + defaultFlags;
}

/**
 * Creates a regular expression from a given pattern
 */
function createRegexp(pattern: string, flags: string, defaultFlags: string = '') : RegExp | null {
  try {
    return new RegExp(pattern, 'u' + buildFlags(flags, defaultFlags));
  } catch (_err) {
    if (isNotImplemented(_err)) {
      throw _err;
    }
  }

  return null;
}