import { toComparable } from './temporal.js';

import { getType } from './types.js';

/**
 * The FEEL types whose values are temporal instants (`date`, `time` and
 * `date and time`). They are mutually incomparable: a value of one type is
 * not comparable to a value of another.
 */
const TEMPORAL_INSTANT_TYPES = new Set([ 'date', 'time', 'date time' ]);


/**
 * This module is the single place in the code base that deals with FEEL
 * <range> values.
 *
 * A {@link FeelRange} is pure data (its bounds and their inclusion) plus a
 * non-enumerable {@link FeelRange#valueType} that records the FEEL type of
 * its elements (e.g. `number`, `date`). All behavior — membership
 * ({@link FeelRange#includes}), iteration ({@link FeelRange#map}) and the
 * range relations ({@link rangeRelations}) — is derived from that data
 * through a single comparator ({@link cmp}). Because the comparator
 * routes temporal values through {@link toComparable}, ranges of dates,
 * times and durations compare correctly, just like ranges of numbers and
 * strings.
 */

/**
 * A value that may appear as a range bound: a number, a string or a FEEL
 * temporal value (date, time, date time or duration).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RangeValue = any;

export type FeelRangeProps = {
  'start included': boolean;
  'end included': boolean;
  start: RangeValue | null;
  end: RangeValue | null;
  valueType: string | null;
};

/**
 * A FEEL <range> (e.g. `[1..10]`, `(date("2020-01-01")..date("2020-12-31")]`).
 *
 * The FEEL-visible properties are `start`, `end`, `start included` and
 * `end included`. The element type is tracked separately (and
 * non-enumerably) as {@link valueType} so it does not leak into context
 * spreads or path access.
 */
export class FeelRange {

  'start included': boolean;
  'end included': boolean;
  start: RangeValue | null;
  end: RangeValue | null;

  /**
   * @internal FEEL type of the range elements, `null` for the empty range
   */
  valueType: string | null;

  constructor(props: FeelRangeProps) {
    Object.assign(this, props);

    // the element type is identity, not a FEEL-visible property; keep it
    // non-enumerable so it does not leak into context spreads / path access
    Object.defineProperty(this, 'valueType', { enumerable: false });
  }

  /**
   * Whether the range includes the given point or range. Returns `null`
   * for the empty range or a `null` probe.
   */
  includes(value: RangeValue | null) : boolean | null {
    return rangeIncludes(this, value);
  }

  /**
   * Enumerate the range, applying `fn` to each element. Only defined for
   * closed number ranges and single-character string ranges.
   */
  map<T>(fn: (val: RangeValue) => T) : T[] {
    return rangeMap(this, fn);
  }

  toString() : string {
    const startBracket = this['start included'] ? '[' : '(';
    const endBracket = this['end included'] ? ']' : ')';

    return `${startBracket}${this.start}..${this.end}${endBracket}`;
  }
}

/**
 * Whether the value is a FEEL <range>.
 */
export function isRange(obj) : obj is FeelRange {
  return obj instanceof FeelRange;
}


// comparator ////////////////////////////////////////////////////////

/**
 * Reduce a range value to something orderable: temporal values become
 * their comparable number, everything else (numbers, strings) is used
 * as-is.
 */
function comparable(value: RangeValue) : RangeValue {
  const c = toComparable(value);

  return c === null ? value : c;
}

/**
 * Compare two same-typed, non-null range values. Returns `-1`, `0` or
 * `1`.
 */
function cmp(a: RangeValue, b: RangeValue) : number {
  const ca = comparable(a);
  const cb = comparable(b);

  if (ca < cb) {
    return -1;
  }

  if (ca > cb) {
    return 1;
  }

  return 0;
}


// membership ////////////////////////////////////////////////////////

function afterStart(value, start, startIncluded) {
  if (start === null) {
    return true;
  }

  const c = cmp(value, start);

  return startIncluded ? c >= 0 : c > 0;
}

function beforeEnd(value, end, endIncluded) {
  if (end === null) {
    return true;
  }

  const c = cmp(value, end);

  return endIncluded ? c <= 0 : c < 0;
}

function rangeIncludes(range: FeelRange, value: RangeValue | null) : boolean | null {

  let { start, end } = range;
  let startIncluded = range['start included'];
  let endIncluded = range['end included'];

  // empty range
  if (start === null && end === null) {
    return null;
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof FeelRange) {
    return rangeIncludesRange(range, value);
  }

  // `date`, `time` and `date and time` are distinct FEEL types; a probe
  // of one temporal type is not comparable to a range of another (hence
  // `null` rather than `false`)
  const valueType = getType(value);

  if (
    range.valueType !== null &&
    TEMPORAL_INSTANT_TYPES.has(valueType) &&
    TEMPORAL_INSTANT_TYPES.has(range.valueType) &&
    valueType !== range.valueType
  ) {
    return null;
  }

  // normalize a descending range (e.g. `[10..1]`) so bounds are ordered
  if (start !== null && end !== null && cmp(start, end) > 0) {
    [ start, end ] = [ end, start ];
    [ startIncluded, endIncluded ] = [ endIncluded, startIncluded ];
  }

  return (
    afterStart(value, start, startIncluded) &&
    beforeEnd(value, end, endIncluded)
  );
}

function rangeIncludesRange(container: FeelRange, value: FeelRange) : boolean {

  const startOk = container.start === null || (
    value.start !== null && (() => {
      const c = cmp(container.start, value.start);

      return c < 0 || (
        c === 0 && (container['start included'] || !value['start included'])
      );
    })()
  );

  const endOk = container.end === null || (
    value.end !== null && (() => {
      const c = cmp(container.end, value.end);

      return c > 0 || (
        c === 0 && (container['end included'] || !value['end included'])
      );
    })()
  );

  return startOk && endOk;
}


// relations (DMN 1.5, 10.3.4.9, Table 78) ///////////////////////////

type Ternary = boolean | null;

/**
 * A relation between points and / or ranges, implemented for the
 * argument combinations it is defined for: point / point (`pp`),
 * point / range (`pr`), range / point (`rp`) and range / range (`rr`).
 */
export type RangeRelation = {
  pp?: (point1: RangeValue, point2: RangeValue) => Ternary;
  pr?: (point: RangeValue, range: FeelRange) => Ternary;
  rp?: (range: FeelRange, point: RangeValue) => Ternary;
  rr?: (range1: FeelRange, range2: FeelRange) => Ternary;
};

/**
 * The endpoint of an unbounded range side, ordered before (`-1`) or
 * after (`1`) every other value.
 */
type Infinite = { readonly infinity: -1 | 1 };

const NEGATIVE_INFINITY: Infinite = { infinity: -1 };
const POSITIVE_INFINITY: Infinite = { infinity: 1 };

function isInfinite(value: RangeValue) : value is Infinite {
  return value === NEGATIVE_INFINITY || value === POSITIVE_INFINITY;
}

/**
 * The start of the range; negative infinity if the range is unbounded
 * to the left (e.g. `< 10`).
 */
function lower(range: FeelRange) : RangeValue {
  return range.start === null ? NEGATIVE_INFINITY : range.start;
}

/**
 * The end of the range; positive infinity if the range is unbounded
 * to the right (e.g. `> 10`).
 */
function upper(range: FeelRange) : RangeValue {
  return range.end === null ? POSITIVE_INFINITY : range.end;
}

/**
 * Whether the range includes its start; an unbounded side never
 * includes its (infinite) endpoint.
 */
function si(range: FeelRange) : boolean {
  return range.start !== null && range['start included'];
}

/**
 * Whether the range includes its end; an unbounded side never includes
 * its (infinite) endpoint.
 */
function ei(range: FeelRange) : boolean {
  return range.end !== null && range['end included'];
}

/**
 * Compare two points or range endpoints. Returns `-1`, `0` or `1`, or
 * `null` if the values are not comparable (`null`, or of different or
 * unordered types).
 */
function compare(a: RangeValue, b: RangeValue) : number | null {

  if (isInfinite(a) || isInfinite(b)) {
    const ia = isInfinite(a) ? a.infinity : 0;
    const ib = isInfinite(b) ? b.infinity : 0;

    return ia === ib ? 0 : ia < ib ? -1 : 1;
  }

  if (a === null || b === null) {
    return null;
  }

  const type = getType(a);

  if (type !== getType(b) || !RANGE_TYPES.has(type)) {
    return null;
  }

  return cmp(a, b);
}

function lt(a: RangeValue, b: RangeValue) : Ternary {
  const c = compare(a, b);

  return c === null ? null : c < 0;
}

function gt(a: RangeValue, b: RangeValue) : Ternary {
  const c = compare(a, b);

  return c === null ? null : c > 0;
}

function eq(a: RangeValue, b: RangeValue) : Ternary {
  const c = compare(a, b);

  return c === null ? null : c === 0;
}

/**
 * Three-valued conjunction: `false` wins over `null` (unknown).
 */
function and(...values: Ternary[]) : Ternary {
  return values.includes(false) ? false : values.includes(null) ? null : true;
}

/**
 * Three-valued disjunction: `true` wins over `null` (unknown).
 */
function or(...values: Ternary[]) : Ternary {
  return values.includes(true) ? true : values.includes(null) ? null : false;
}

/**
 * The relation with swapped arguments, e.g. `after` from `before`.
 */
function inverse(relation: RangeRelation) : RangeRelation {

  const { pp, pr, rp, rr } = relation;

  return {
    pp: pp && ((point1, point2) => pp(point2, point1)),
    pr: rp && ((point, range) => rp(range, point)),
    rp: pr && ((range, point) => pr(point, range)),
    rr: rr && ((range1, range2) => rr(range2, range1))
  };
}

const before: RangeRelation = {
  pp: (p1, p2) => lt(p1, p2),
  pr: (p, r) => or(
    lt(p, lower(r)),
    and(eq(p, lower(r)), !si(r))
  ),
  rp: (r, p) => or(
    lt(upper(r), p),
    and(eq(upper(r), p), !ei(r))
  ),
  rr: (r1, r2) => or(
    lt(upper(r1), lower(r2)),
    and(eq(upper(r1), lower(r2)), !ei(r1) || !si(r2))
  )
};

const meets: RangeRelation = {
  rr: (r1, r2) => and(ei(r1), si(r2), eq(upper(r1), lower(r2)))
};

const overlaps: RangeRelation = {
  rr: (r1, r2) => and(
    or(
      gt(upper(r1), lower(r2)),
      and(eq(upper(r1), lower(r2)), ei(r1), si(r2))
    ),
    or(
      lt(lower(r1), upper(r2)),
      and(eq(lower(r1), upper(r2)), si(r1), ei(r2))
    )
  )
};

const overlapsBefore: RangeRelation = {
  rr: (r1, r2) => and(
    or(
      lt(lower(r1), lower(r2)),
      and(eq(lower(r1), lower(r2)), si(r1), !si(r2))
    ),
    or(
      gt(upper(r1), lower(r2)),
      and(eq(upper(r1), lower(r2)), ei(r1), si(r2))
    ),
    or(
      lt(upper(r1), upper(r2)),
      and(eq(upper(r1), upper(r2)), !ei(r1) || ei(r2))
    )
  )
};

const finishes: RangeRelation = {
  pr: (p, r) => and(ei(r), eq(upper(r), p)),
  rr: (r1, r2) => and(
    ei(r1) === ei(r2),
    eq(upper(r1), upper(r2)),
    or(
      gt(lower(r1), lower(r2)),
      and(eq(lower(r1), lower(r2)), !si(r1) || si(r2))
    )
  )
};

const includes: RangeRelation = {
  rp: (r, p) => or(
    and(lt(lower(r), p), gt(upper(r), p)),
    and(eq(lower(r), p), si(r)),
    and(eq(upper(r), p), ei(r))
  ),
  rr: (r1, r2) => and(
    or(
      lt(lower(r1), lower(r2)),
      and(eq(lower(r1), lower(r2)), si(r1) || !si(r2))
    ),
    or(
      gt(upper(r1), upper(r2)),
      and(eq(upper(r1), upper(r2)), ei(r1) || !ei(r2))
    )
  )
};

const starts: RangeRelation = {
  pr: (p, r) => and(eq(lower(r), p), si(r)),
  rr: (r1, r2) => and(
    eq(lower(r1), lower(r2)),
    si(r1) === si(r2),
    or(
      lt(upper(r1), upper(r2)),
      and(eq(upper(r1), upper(r2)), !ei(r1) || ei(r2))
    )
  )
};

const coincides: RangeRelation = {
  pp: (p1, p2) => eq(p1, p2),
  rr: (r1, r2) => and(
    eq(lower(r1), lower(r2)),
    si(r1) === si(r2),
    eq(upper(r1), upper(r2)),
    ei(r1) === ei(r2)
  )
};

/**
 * The range relations of the built-in range functions, by name. Inverse
 * relations (e.g. `after`, `met by`) are defined in Table 78 exactly as
 * their counterparts with swapped arguments.
 */
export const rangeRelations: Record<string, RangeRelation> = {
  'before': before,
  'after': inverse(before),
  'meets': meets,
  'met by': inverse(meets),
  'overlaps': overlaps,
  'overlaps before': overlapsBefore,
  'overlaps after': inverse(overlapsBefore),
  'finishes': finishes,
  'finished by': inverse(finishes),
  'includes': includes,
  'during': inverse(includes),
  'starts': starts,
  'started by': inverse(starts),
  'coincides': coincides
};

/**
 * Apply a relation to two (non-null) points and / or ranges. Returns
 * `undefined` if the relation is not defined for the given combination
 * of points and ranges, and `null` if the result is unknown (e.g. for
 * values that are not comparable).
 */
export function relate(relation: RangeRelation, a: RangeValue, b: RangeValue) : Ternary | undefined {

  const aRange = isRange(a);
  const bRange = isRange(b);

  const impl: (a: RangeValue, b: RangeValue) => Ternary = (
    aRange
      ? (bRange ? relation.rr : relation.rp)
      : (bRange ? relation.pr : relation.pp)
  );

  if (!impl) {
    return undefined;
  }

  // the empty range (without any bounds) relates to nothing
  if (aRange && isEmpty(a) || bRange && isEmpty(b)) {
    return null;
  }

  return impl(a, b);
}

function isEmpty(range: FeelRange) : boolean {
  return range.start === null && range.end === null;
}


// iteration /////////////////////////////////////////////////////////

const CHARS = Array.from(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
);

const CHAR_TO_INDEX = new Map(CHARS.map((c, i) => [ c, i ]));

function rangeMap<T>(range: FeelRange, fn: (val: RangeValue) => T) : T[] {

  const { start, end, valueType } = range;

  // empty range
  if (start === null && end === null) {
    return [];
  }

  if (valueType === 'number' && start !== null && end !== null) {
    return numberRangeMap(start, end, range['start included'], range['end included'], fn);
  }

  if (valueType === 'string' && start !== null && end !== null) {
    const values = charRangeValues(start, end, range['start included'], range['end included']);

    if (values) {
      return values.map(fn);
    }
  }

  throw new Error('unsupported range operation: map');
}

function numberRangeMap<T>(start, end, startIncluded, endIncluded, fn: (val) => T) : T[] {

  const direction = start > end ? -1 : 1;

  const result: T[] = [];

  for (let i = start;; i += direction) {

    if (i === start && !startIncluded) {
      continue;
    }

    if (i === end && !endIncluded) {
      break;
    }

    result.push(fn(i));

    if (i === end) {
      break;
    }
  }

  return result;
}

function charRangeValues(start, end, startIncluded, endIncluded) : string[] | null {

  let startIdx = CHAR_TO_INDEX.get(start);
  let endIdx = CHAR_TO_INDEX.get(end);

  if (startIdx === undefined || endIdx === undefined) {
    return null;
  }

  const direction = startIdx > endIdx ? -1 : 1;

  if (startIncluded === false) {
    startIdx += direction;
  }

  if (endIncluded === false) {
    endIdx -= direction;
  }

  return CHARS.slice(
    Math.min(startIdx, endIdx),
    Math.max(startIdx, endIdx) + 1
  );
}


// construction //////////////////////////////////////////////////////

const RANGE_TYPES = new Set([ 'string', 'number', 'duration', 'time', 'date time', 'date' ]);

/**
 * Create a {@link FeelRange} from its bounds, inferring the element type.
 */
export function createRange(
    start: RangeValue | null,
    end: RangeValue | null,
    startIncluded = true,
    endIncluded = true
) : FeelRange {

  // infer the element type: the shared FEEL type of the non-null bounds
  const startType = start === null ? null : getType(start);
  const endType = end === null ? null : getType(end);

  const type = startType ?? endType;

  const valueType = (
    type !== null &&
    RANGE_TYPES.has(type) &&
    (startType === null || startType === type) &&
    (endType === null || endType === type)
  ) ? type : null;

  if (valueType === null && !(start === null && end === null)) {
    throw new Error(`unsupported range: ${start}..${end}`);
  }

  return new FeelRange({
    start,
    end,
    'start included': startIncluded,
    'end included': endIncluded,
    valueType
  });
}
