import { Temporal } from 'temporal-polyfill';

/**
 * This module is the single place in the code base that talks to the
 * underlying temporal implementation ({@link Temporal}, provided by
 * `temporal-polyfill`).
 *
 * FEEL temporal values are represented by the wrapper classes
 * {@link FeelDate}, {@link FeelTime}, {@link FeelDateTime} and
 * {@link FeelDuration}. Consumers of the library interact with these
 * wrappers (via `toString()`, component getters and `unwrap()`) rather
 * than with raw `Temporal` objects. This keeps the temporal
 * implementation a swappable internal detail.
 */

/**
 * A fixed reference date used to anchor zoned times and to compute
 * duration totals that require a `relativeTo` (years / months).
 */
const REFERENCE_DATE = Temporal.PlainDate.from('1970-01-01');

/**
 * FEEL supports years in [-999,999,999..999,999,999], Temporal only about
 * ±271,821. A date (or date time) beyond the range natively represented
 * is backed by an in-range proxy plus a year offset that is a multiple of
 * 400: the Gregorian calendar repeats every 400 years (146,097 days, an
 * exact number of weeks), so the proxy shares leap years, weekdays and
 * days of year with the value it represents.
 */
const MAX_FEEL_YEAR = 999_999_999;

const MIN_NATIVE_YEAR = -271_000;
const MAX_NATIVE_YEAR = 275_000;

const CYCLE_YEARS = 400;
const CYCLE_MONTHS = CYCLE_YEARS * 12;
const CYCLE_DAYS = 146_097;

const MS_PER_DAY = 86_400_000;

const MIN_SAFE_MILLISECONDS = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_MILLISECONDS = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Years beyond which date arithmetic is carried out on a proxy, so that
 * the (cycle-reduced) duration cannot leave the Temporal range.
 */
const MAX_ARITHMETIC_YEAR = 200_000;

/**
 * The largest fixed zone offset FEEL supports (`±18:00`).
 */
const MAX_OFFSET_SECONDS = 18 * 3600;

/**
 * The year offset (a multiple of {@link CYCLE_YEARS}) that moves a year
 * into the proxy range `[2000, 2400)`.
 */
function cycleOffset(year: number) : number {
  return Math.floor((year - 2000) / CYCLE_YEARS) * CYCLE_YEARS;
}

/**
 * Split a year into a year natively represented by Temporal and a year
 * offset (`0` for years within the native range).
 */
function splitYear(year: number) : { year: number, offset: number } {

  if (year >= MIN_NATIVE_YEAR && year <= MAX_NATIVE_YEAR) {
    return { year, offset: 0 };
  }

  const offset = cycleOffset(year);

  return { year: year - offset, offset };
}

/**
 * Normalize a (proxied) value and its year offset to the canonical form:
 * values within the native range carry no offset, others are backed by a
 * proxy in `[2000, 2400)`.
 */
function rebase<T extends Temporal.PlainDate | Temporal.PlainDateTime>(value: T, yearOffset: number) : [ T, number ] {

  const { year, offset } = splitYear(value.year + yearOffset);

  if (year === value.year) {
    return [ value, offset ];
  }

  return [ value.with({ year }) as T, offset ];
}

/**
 * Format a year the FEEL way: at least four digits, with a sign for
 * negative years only (e.g. `-2017`, `0001`, `999999999`).
 */
function formatYear(year: number) : string {
  return (year < 0 ? '-' : '') + String(Math.abs(year)).padStart(4, '0');
}

/**
 * Format the date part of a (proxied) value.
 */
function formatDate(value: Temporal.PlainDate | Temporal.PlainDateTime, yearOffset: number) : string {

  const year = value.year + yearOffset;

  return formatYear(year) + '-' +
    String(value.month).padStart(2, '0') + '-' +
    String(value.day).padStart(2, '0');
}

/**
 * Whether a year can be formatted the Temporal way (four digits, no sign).
 */
function isFourDigitYear(year: number) : boolean {
  return year >= 0 && year <= 9999;
}


// wrapper classes ///////////////////////////////////////////////////

/**
 * A FEEL <date> (e.g. `2020-04-06`).
 */
export class FeelDate {

  /**
   * @internal underlying temporal value
   */
  readonly value: Temporal.PlainDate;

  /**
   * Years to add to the underlying temporal value; non-zero (a multiple
   * of 400) for a date beyond the range Temporal supports, in which case
   * {@link value} is an in-range proxy that shares leap years, weekdays
   * and days of year with the date it represents.
   */
  readonly yearOffset: number;

  /**
   * @internal canonical ISO-8601 form; drives both display and
   * structural comparison
   */
  readonly iso: string;

  constructor(value: Temporal.PlainDate, yearOffset = 0) {
    [ this.value, this.yearOffset ] = rebase(value, yearOffset);

    this.iso = this.yearOffset === 0 && isFourDigitYear(this.value.year)
      ? this.value.toString()
      : formatDate(this.value, this.yearOffset);

    // the raw Temporal value is an implementation detail; keep it
    // non-enumerable so structural equality and serialization rely on
    // the canonical `iso` string rather than the underlying value
    Object.defineProperty(this, 'value', { enumerable: false });
    Object.defineProperty(this, 'yearOffset', { enumerable: false });
  }

  get year() { return this.value.year + this.yearOffset; }
  get month() { return this.value.month; }
  get day() { return this.value.day; }
  get weekday() { return this.value.dayOfWeek; }

  /**
   * Return the underlying `Temporal.PlainDate`.
   *
   * Escape hatch for consumers that need the raw temporal value. The
   * returned type is implementation specific and may change. For a date
   * beyond the range Temporal supports this is a proxy, see
   * {@link yearOffset}.
   */
  unwrap() : Temporal.PlainDate {
    return this.value;
  }

  toString() : string {
    return this.iso;
  }

  toJSON() : string {
    return this.iso;
  }
}

/**
 * A FEEL <time>, either local (e.g. `10:30:00`) or zoned
 * (e.g. `10:30:00Z`, `10:30:00+05:00`, `10:30:00@Europe/Paris`).
 */
export class FeelTime {

  /**
   * @internal wall-clock time
   */
  readonly value: Temporal.PlainTime;

  /**
   * @internal time zone identifier, `null` for a local time
   */
  readonly zone: string | null;

  /**
   * @internal canonical form (wall-clock plus zone); drives both
   * display and structural comparison
   */
  readonly iso: string;

  constructor(value: Temporal.PlainTime, zone: string | null = null) {
    this.value = value;
    this.zone = zone;
    this.iso = this.value.toString() + (this.zone === null ? '' : zoneSuffix(this.zone));

    // the raw Temporal value is an implementation detail; keep it
    // non-enumerable so structural equality and serialization rely on
    // the canonical `iso` string rather than the underlying value
    Object.defineProperty(this, 'value', { enumerable: false });
  }

  get hour() { return this.value.hour; }
  get minute() { return this.value.minute; }
  get second() { return this.value.second; }
  get timezone() { return this.zone; }

  /**
   * The zone offset as a {@link FeelDuration}, or `null` for a local time.
   */
  get 'time offset'() {
    return this.zone === null ? null : zoneOffset(this);
  }

  /**
   * Return the underlying wall-clock `Temporal.PlainTime`.
   *
   * Escape hatch for consumers that need the raw temporal value. Zone
   * information is available via {@link timezone} / {@link 'time offset'}.
   */
  unwrap() : Temporal.PlainTime {
    return this.value;
  }

  toString() : string {
    return this.iso;
  }

  toJSON() : string {
    return this.iso;
  }
}

/**
 * A FEEL <date and time>, either local (e.g. `2020-04-06T10:30:00`) or
 * zoned (e.g. `...Z`, `...+05:00`, `...@Europe/Paris`).
 */
export class FeelDateTime {

  /**
   * @internal wall-clock date and time
   */
  readonly value: Temporal.PlainDateTime;

  /**
   * @internal time zone identifier, `null` for a local date time
   */
  readonly zone: string | null;

  /**
   * Years to add to the underlying temporal value; non-zero (a multiple
   * of 400) for a date time beyond the range Temporal supports, in which
   * case {@link value} is an in-range proxy (see {@link FeelDate.yearOffset}).
   */
  readonly yearOffset: number;

  /**
   * @internal canonical form (wall-clock plus zone); drives both
   * display and structural comparison
   */
  readonly iso: string;

  constructor(value: Temporal.PlainDateTime, zone: string | null = null, yearOffset = 0) {
    [ this.value, this.yearOffset ] = rebase(value, yearOffset);
    this.zone = zone;

    const wallClock = this.yearOffset === 0 && isFourDigitYear(this.value.year)
      ? this.value.toString()
      : formatDate(this.value, this.yearOffset) + 'T' + this.value.toPlainTime().toString();

    this.iso = wallClock + (this.zone === null ? '' : zoneSuffix(this.zone));

    // the raw Temporal value is an implementation detail; keep it
    // non-enumerable so structural equality and serialization rely on
    // the canonical `iso` string rather than the underlying value
    Object.defineProperty(this, 'value', { enumerable: false });
    Object.defineProperty(this, 'yearOffset', { enumerable: false });
  }

  get year() { return this.value.year + this.yearOffset; }
  get month() { return this.value.month; }
  get day() { return this.value.day; }
  get hour() { return this.value.hour; }
  get minute() { return this.value.minute; }
  get second() { return this.value.second; }
  get weekday() { return this.value.dayOfWeek; }
  get timezone() { return this.zone; }

  get 'time offset'() {
    return this.zone === null ? null : zoneOffset(this);
  }

  /**
   * Return the underlying wall-clock `Temporal.PlainDateTime`.
   *
   * Escape hatch for consumers that need the raw temporal value. Zone
   * information is available via {@link timezone} / {@link 'time offset'}.
   * For a date time beyond the range Temporal supports this is a proxy,
   * see {@link yearOffset}.
   */
  unwrap() : Temporal.PlainDateTime {
    return this.value;
  }

  toString() : string {
    return this.iso;
  }

  toJSON() : string {
    return this.iso;
  }
}

/**
 * A FEEL <duration>, both `years and months` and `days and time`
 * durations (e.g. `P1Y2M`, `P2DT3H`).
 */
export class FeelDuration {

  /**
   * @internal normalized underlying duration
   */
  readonly value: Temporal.Duration;

  /**
   * @internal whether this is a years and months (rather than a
   * days and time) duration; retained so the category survives even a
   * zero-valued duration (e.g. `P0M` vs `PT0S`)
   */
  readonly yearsMonths: boolean;

  /**
   * @internal category-aware canonical ISO-8601 form; drives both
   * display and structural comparison
   */
  readonly iso: string;

  constructor(value: Temporal.Duration, yearsMonths?: boolean) {
    this.value = normalize(value);
    this.yearsMonths = yearsMonths ?? isYearsMonths(this.value);

    // a zero years and months duration would otherwise stringify as
    // `PT0S`, dropping its category
    this.iso = this.yearsMonths && this.value.sign === 0
      ? 'P0M'
      : this.value.toString();

    // the raw Temporal value is an implementation detail; keep it
    // non-enumerable so structural equality and serialization rely on
    // the category-aware `iso` string rather than the underlying
    // duration, whose years / months totals require a `relativeTo`
    // anchor and are not deep-comparable
    Object.defineProperty(this, 'value', { enumerable: false });
  }

  get years() { return this.yearsMonths ? this.value.years : null; }
  get months() { return this.yearsMonths ? this.value.months : null; }
  get days() { return this.yearsMonths ? null : this.value.days; }
  get hours() { return this.yearsMonths ? null : this.value.hours; }
  get minutes() { return this.yearsMonths ? null : this.value.minutes; }
  get seconds() { return this.yearsMonths ? null : this.value.seconds; }

  /**
   * Return the underlying `Temporal.Duration`.
   *
   * Escape hatch for consumers that need the raw temporal value. The
   * returned type is implementation specific and may change.
   */
  unwrap() : Temporal.Duration {
    return this.value;
  }

  toString() : string {
    return this.iso;
  }

  toJSON() : string {
    return this.iso;
  }
}

/**
 * Any FEEL temporal instant (date, time or date time).
 */
export type FeelTemporal = FeelDate | FeelTime | FeelDateTime;


// type guards ///////////////////////////////////////////////////////

export function isDate(obj) : obj is FeelDate {
  return obj instanceof FeelDate;
}

export function isTime(obj) : obj is FeelTime {
  return obj instanceof FeelTime;
}

export function isDateTime(obj) : obj is FeelDateTime {
  return obj instanceof FeelDateTime;
}

export function isDuration(obj) : obj is FeelDuration {
  return obj instanceof FeelDuration;
}

/**
 * Whether the value is any temporal instant (date, time or date time),
 * i.e. anything but a duration.
 */
export function isTemporal(obj) : obj is FeelTemporal {
  return isDate(obj) || isTime(obj) || isDateTime(obj);
}

/**
 * Whether the temporal value carries a time zone.
 */
export function isZoned(obj) : boolean {
  return (isTime(obj) || isDateTime(obj)) && obj.zone !== null;
}


// zone helpers //////////////////////////////////////////////////////

const Z_SUFFIX_PATTERN = /z$/i;

const OFFSET_SUFFIX_PATTERN = /[+-]\d{2}:\d{2}(:\d{2})?$/;

const OFFSET_ZONE_PATTERN = /^[+-]\d{2}:\d{2}(:\d{2})?$/;

const OFFSET_SECONDS_PATTERN = /^([+-])(\d{2}):(\d{2}):(\d{2})$/;

const FIXED_OFFSET_PATTERN = /^([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/;

const YEARS_MONTHS_PATTERN = /[YM]/;

const LEAP_SECOND_PATTERN = /^\d{2}:\d{2}:60/;

/**
 * Split a trailing time zone indicator off an ISO date / time string.
 *
 * Recognizes `Z`, numeric offsets (`+HH:MM`) and named zones (`@Zone`).
 * Returns the time zone as a Temporal time zone identifier
 * (`Z` becomes `UTC`).
 */
function splitZone(str: string) : { value: string, zone: string | null } {

  const atIndex = str.indexOf('@');

  if (atIndex !== -1) {
    return {
      value: str.substring(0, atIndex),
      zone: str.substring(atIndex + 1)
    };
  }

  if (Z_SUFFIX_PATTERN.test(str)) {
    return {
      value: str.substring(0, str.length - 1),
      zone: 'UTC'
    };
  }

  const offsetMatch = OFFSET_SUFFIX_PATTERN.exec(str);

  if (offsetMatch) {
    return {
      value: str.substring(0, offsetMatch.index),
      zone: offsetMatch[0]
    };
  }

  return {
    value: str,
    zone: null
  };
}

/**
 * Return the FEEL time zone suffix for a time zone identifier, e.g.
 * `Z`, `+05:00` or `@Europe/Paris`.
 */
function zoneSuffix(zone: string) : string {

  if (zone === 'UTC') {
    return 'Z';
  }

  if (OFFSET_ZONE_PATTERN.test(zone)) {
    return zone;
  }

  return `@${zone}`;
}

/**
 * The offset, in seconds, of a fixed numeric offset zone
 * (`+HH:MM` or `+HH:MM:SS`). Returns `null` for named zones (including
 * `UTC`), which are resolved through Temporal instead.
 *
 * Temporal itself only accepts offset zones to minute precision, so
 * sub-minute offsets are handled through this manual path.
 */
function offsetZoneSeconds(zone: string | null) : number | null {

  if (zone === null) {
    return null;
  }

  const match = OFFSET_SECONDS_PATTERN.exec(zone);

  if (!match) {
    return null;
  }

  const sign = match[1] === '-' ? -1 : 1;

  return sign * (Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4]));
}

/**
 * The offset, in seconds, of a fixed offset zone (`Z` / `UTC`,
 * `+HH:MM` or `+HH:MM:SS`). Returns `null` for named (IANA) zones.
 */
function fixedOffsetSeconds(zone: string) : number | null {

  if (zone === 'UTC') {
    return 0;
  }

  const match = FIXED_OFFSET_PATTERN.exec(zone);

  if (!match) {
    return null;
  }

  const sign = match[1] === '-' ? -1 : 1;

  return sign * (Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4] ?? 0));
}

/**
 * Whether a zone identifier is usable: a known (IANA) zone or a fixed
 * offset within ±18:00. Fixed offsets are validated by range, as
 * Temporal accepts offsets up to ±24h but rejects sub-minute ones.
 */
const zoneValidity = new Set<string>();

function isValidZone(zone: string | null) : boolean {

  if (zone === null) {
    return true;
  }

  const offsetMatch = FIXED_OFFSET_PATTERN.exec(zone);

  if (offsetMatch) {
    const [ , , , minutes, seconds = '0' ] = offsetMatch;

    return Number(minutes) < 60 && Number(seconds) < 60 &&
      Math.abs(fixedOffsetSeconds(zone)) <= MAX_OFFSET_SECONDS;
  }

  // cache positive results only: the set of valid zones is bounded in
  // practice, while arbitrary invalid strings must not grow the cache
  if (zoneValidity.has(zone)) {
    return true;
  }

  try {

    // throws for an unknown zone
    new Temporal.PlainDateTime(1970, 1, 1).toZonedDateTime(zone);
  } catch {
    return false;
  }

  zoneValidity.add(zone);

  return true;
}

/**
 * Whether two zone identifiers denote the same zone, for the purpose of
 * strict (`is`) equality: fixed offsets compare by offset (`Z` equals
 * `+00:00`), named zones only by identifier.
 */
export function zoneEquals(a: string | null, b: string | null) : boolean {

  if (a === null || b === null) {
    return a === b;
  }

  const aOffset = fixedOffsetSeconds(a);
  const bOffset = fixedOffsetSeconds(b);

  if (aOffset !== null && bOffset !== null) {
    return aOffset === bOffset;
  }

  return a === b;
}

/**
 * Resolve a zoned temporal to a concrete `Temporal.ZonedDateTime`,
 * anchoring zoned times to {@link REFERENCE_DATE}.
 */
function zonedDateTime(temporal: FeelTime | FeelDateTime) : Temporal.ZonedDateTime {

  if (temporal instanceof FeelTime) {
    return REFERENCE_DATE.toZonedDateTime({
      plainTime: temporal.value,
      timeZone: temporal.zone
    });
  }

  return temporal.value.toZonedDateTime(temporal.zone);
}

/**
 * Return the zone offset of a zoned date time as a {@link FeelDuration}.
 */
function offsetDuration(zdt: Temporal.ZonedDateTime) : FeelDuration {
  return new FeelDuration(Temporal.Duration.from({ nanoseconds: zdt.offsetNanoseconds }));
}

/**
 * Return the zone offset of a zoned temporal as a {@link FeelDuration}.
 *
 * Sub-minute numeric offsets are resolved directly (Temporal only
 * supports offset zones to minute precision); everything else is
 * resolved through {@link zonedDateTime}.
 */
function zoneOffset(temporal: FeelTime | FeelDateTime) : FeelDuration {

  const seconds = offsetZoneSeconds(temporal.zone);

  if (seconds !== null) {
    return new FeelDuration(Temporal.Duration.from({ seconds }), false);
  }

  return offsetDuration(zonedDateTime(temporal));
}


// comparison ////////////////////////////////////////////////////////

/**
 * Convert a temporal value to a comparable number of milliseconds
 * (a `bigint` for instants beyond the range of safe integers).
 *
 * Wall-clock (zone-less) values are anchored to UTC so they compare
 * consistently among themselves.
 */
export function toComparable(value) : number | bigint | null {

  // a value beyond the Temporal range compares as its proxy, shifted by
  // the skipped Gregorian cycles; beyond the range of safe integers, the
  // milliseconds are a `bigint` (equal instants always yield the same
  // type, and numbers and bigints order correctly)
  if ((isDate(value) || isDateTime(value)) && value.yearOffset !== 0) {

    const proxyMilliseconds = toComparable(withYearOffset(value, -value.yearOffset)) as number;

    const milliseconds = BigInt(proxyMilliseconds) +
      BigInt(value.yearOffset / CYCLE_YEARS) * BigInt(CYCLE_DAYS * MS_PER_DAY);

    return milliseconds >= MIN_SAFE_MILLISECONDS && milliseconds <= MAX_SAFE_MILLISECONDS
      ? Number(milliseconds)
      : milliseconds;
  }

  if (isDate(value)) {
    return value.value.toZonedDateTime('UTC').epochMilliseconds;
  }

  if (isTime(value) || isDateTime(value)) {

    const offsetSeconds = offsetZoneSeconds(value.zone);

    // sub-minute offset zone: interpret the wall clock at UTC, then
    // shift by the fixed offset (Temporal rejects such offset zones)
    if (offsetSeconds !== null) {
      const utcEpoch = (value instanceof FeelTime
        ? REFERENCE_DATE.toZonedDateTime({ plainTime: value.value, timeZone: 'UTC' })
        : value.value.toZonedDateTime('UTC')
      ).epochMilliseconds;

      return utcEpoch - offsetSeconds * 1000;
    }

    const zone = value.zone ?? 'UTC';

    return (value instanceof FeelTime
      ? REFERENCE_DATE.toZonedDateTime({ plainTime: value.value, timeZone: zone })
      : value.value.toZonedDateTime(zone)
    ).epochMilliseconds;
  }

  if (isDuration(value)) {
    return durationTotal(value.value, 'millisecond');
  }

  return null;
}


// duration //////////////////////////////////////////////////////////

/**
 * Normalize a duration: years / months durations balance into years and
 * months, everything else balances into days and time.
 */
function normalize(d: Temporal.Duration) : Temporal.Duration {

  // pure years and months / days and time durations balance without an
  // anchor date, supporting values beyond the range of the anchor
  // (e.g. `P999999999M`)
  if (d.years === 0 && d.months === 0) {
    return d.weeks === 0
      ? d.round({ largestUnit: 'day' })
      : d.round({ largestUnit: 'day', relativeTo: REFERENCE_DATE });
  }

  if (d.weeks === 0 && !hasDayTimeComponent(d)) {
    return yearsMonthsDuration(d.years * 12 + d.months);
  }

  return d.round({ largestUnit: 'year', relativeTo: REFERENCE_DATE });
}

/**
 * A normalized years and months duration spanning the given months.
 */
function yearsMonthsDuration(months: number) : Temporal.Duration {
  return Temporal.Duration.from({
    years: Math.trunc(months / 12),
    months: months % 12
  });
}

/**
 * Whether a duration carries a days or time component.
 */
function hasDayTimeComponent(d: Temporal.Duration) : boolean {
  const { days, hours, minutes, seconds, milliseconds, microseconds, nanoseconds } = d;

  return !!(days || hours || minutes || seconds || milliseconds || microseconds || nanoseconds);
}

/**
 * The length of a Gregorian cycle ({@link CYCLE_YEARS}) in the given unit.
 */
const CYCLE_TOTALS = {
  year: CYCLE_YEARS,
  month: CYCLE_MONTHS,
  week: CYCLE_DAYS / 7,
  day: CYCLE_DAYS,
  hour: CYCLE_DAYS * 24,
  minute: CYCLE_DAYS * 1440,
  second: CYCLE_DAYS * 86_400,
  millisecond: CYCLE_DAYS * MS_PER_DAY,
  microsecond: CYCLE_DAYS * MS_PER_DAY * 1e3,
  nanosecond: CYCLE_DAYS * MS_PER_DAY * 1e6
};

/**
 * The total of a duration in the given unit, relative to
 * {@link REFERENCE_DATE}.
 *
 * Whole Gregorian cycles contained in the duration are accounted for by
 * their fixed length, so that durations beyond the range of the anchor
 * date (e.g. `P99999999Y`) can be totaled, too.
 */
function durationTotal(d: Temporal.Duration, unit: keyof typeof CYCLE_TOTALS) : number {

  const months = d.years * 12 + d.months;

  const cycles = Math.trunc(months / CYCLE_MONTHS) + Math.trunc(d.days / CYCLE_DAYS);

  if (cycles === 0) {
    return d.total({ unit, relativeTo: REFERENCE_DATE });
  }

  const rest = d.with({
    years: 0,
    months: months % CYCLE_MONTHS,
    days: d.days % CYCLE_DAYS
  });

  return rest.total({ unit, relativeTo: REFERENCE_DATE }) + cycles * CYCLE_TOTALS[unit];
}

/**
 * Whether a duration is a years and months duration (rather than a
 * days and time duration). Years and months durations only expose
 * `years` / `months` components; days and time durations only expose
 * `days` / `hours` / `minutes` / `seconds`.
 */
function isYearsMonths(d: Temporal.Duration) : boolean {
  return d.years !== 0 || d.months !== 0;
}

/**
 * Whether an ISO-8601 duration literal denotes a years and months
 * duration, i.e. carries a year (`Y`) or month (`M`) component in its
 * date part. Retains the category even when the value is zero
 * (`P0Y` / `P0M` vs `P0D` / `PT0S`).
 */
function isYearsMonthsString(str: string) : boolean {
  const datePart = str.split('T')[0];
  return YEARS_MONTHS_PATTERN.test(datePart);
}

/**
 * Whether two durations are equal, comparing years / months durations by
 * month and days / time durations by second (mirroring FEEL semantics).
 */
export function durationEquals(a: FeelDuration, b: FeelDuration) : boolean {

  const total = (d: FeelDuration, unit) => durationTotal(d.value, unit);

  // years and months duration -> compare in months
  if (Math.abs(total(a, 'day')) > 180) {
    return Math.trunc(total(a, 'month') - total(b, 'month')) === 0;
  }

  // days and time duration -> compare in seconds
  return Math.trunc(total(a, 'second') - total(b, 'second')) === 0;
}

// the FEEL duration grammar: `P[nY][nM][nD][T[nH][nM][nS]]` with at least
// one component; notably the ISO-8601 week designator (`W`) is not part
// of it (see #105)
const DURATION_PATTERN = /^-?P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d*)?S)?)?$/;

export function duration(opts: string | number) : FeelDuration | null {

  if (typeof opts === 'number') {
    return new FeelDuration(Temporal.Duration.from({ milliseconds: opts }), false);
  }

  if (!DURATION_PATTERN.test(opts)) {
    return null;
  }

  try {

    // Temporal requires digits after a decimal point (`PT0.S`)
    const iso = opts.replace(/\.S$/, 'S');

    return new FeelDuration(Temporal.Duration.from(iso), isYearsMonthsString(opts));
  } catch {
    return null;
  }
}

/**
 * Return the absolute (non-negative) value of a duration.
 */
export function absDuration(d: FeelDuration) : FeelDuration {
  return new FeelDuration(d.value.abs(), d.yearsMonths);
}

/**
 * Whether a duration carries a sub-day (time) component.
 */
function hasTimeComponent(d: FeelDuration) : boolean {
  const { hours, minutes, seconds, milliseconds } = d.value;

  return !!(hours || minutes || seconds || milliseconds);
}


// arithmetic ////////////////////////////////////////////////////////

/**
 * Add (`sign > 0`) or subtract (`sign < 0`) a duration from a temporal
 * instant, returning a new temporal instant.
 *
 * A local <date> combined with a time-bearing duration is promoted to a
 * UTC <date and time> (bare dates are anchored in UTC).
 */
export function addDuration(temporal: FeelTemporal, dur: FeelDuration, sign: number) : FeelTemporal | null {

  if (!isTime(temporal) && needsExtendedArithmetic(temporal, dur)) {
    return addDurationExtended(temporal, dur, sign);
  }

  const d = sign < 0 ? dur.value.negated() : dur.value;

  if (isDate(temporal)) {

    if (hasTimeComponent(dur)) {
      return new FeelDateTime(temporal.value.toPlainDateTime().add(d), 'UTC');
    }

    return new FeelDate(temporal.value.add(d));
  }

  if (isTime(temporal)) {

    // times wrap around midnight and keep their zone
    return new FeelTime(temporal.value.add(d), temporal.zone);
  }

  // date time
  if (temporal.zone === null) {
    return new FeelDateTime(temporal.value.add(d), null);
  }

  // a fixed sub-minute offset has no DST, so shifting the wall clock is
  // equivalent (and Temporal rejects such offset zones anyway)
  if (offsetZoneSeconds(temporal.zone) !== null) {
    return new FeelDateTime(temporal.value.add(d), temporal.zone);
  }

  // honor the zone (e.g. DST) for zoned date times
  const shifted = temporal.value.toZonedDateTime(temporal.zone).add(d);

  return new FeelDateTime(shifted.toPlainDateTime(), temporal.zone);
}

/**
 * Subtract two temporal instants, yielding a {@link FeelDuration}.
 */
export function subtractTemporals(a: FeelTemporal, b: FeelTemporal) : FeelDuration | null {

  if (yearOffsetOf(a) !== 0 || yearOffsetOf(b) !== 0) {
    return subtractTemporalsExtended(a, b);
  }

  if (isTime(a) && isTime(b)) {
    return new FeelDuration(a.value.since(b.value));
  }

  const left = toPlainDateTime(a);
  const right = toPlainDateTime(b);

  return new FeelDuration(left.since(right, { largestUnit: 'day' }));
}

/**
 * Add (`sign > 0`) or subtract (`sign < 0`) two durations of the same
 * kind, returning `null` for a mixed-kind combination.
 *
 * Years / months and days / time durations are distinct FEEL types;
 * combining the two kinds is undefined (mirroring camunda/feel-scala,
 * which has no mixed-kind arithmetic case and yields `null`).
 */
export function addDurations(a: FeelDuration, b: FeelDuration, sign: number) : FeelDuration | null {

  if (a.yearsMonths !== b.yearsMonths) {
    return null;
  }

  const other = sign < 0 ? b.value.negated() : b.value;

  try {

    if (a.yearsMonths) {

      // years / months balance calendar-independently (12 months = 1 year)
      const months = (a.value.years + other.years) * 12 + a.value.months + other.months;

      return new FeelDuration(yearsMonthsDuration(months), true);
    }

    // days / time add directly; days stay 24h units (no calendar balancing,
    // so P20D + P20D is P40D rather than P1M9D)
    return new FeelDuration(a.value.add(other), false);
  } catch {

    // beyond the range of a duration
    return null;
  }
}

/**
 * The <years and months duration> between two dates, counting whole
 * months only.
 */
export function yearsAndMonthsDuration(from: FeelDate, to: FeelDate) : FeelDuration {

  let months = (to.year - from.year) * 12 + (to.month - from.month);

  // the last month is incomplete
  if (months > 0 && from.day > to.day) {
    months--;
  } else if (months < 0 && from.day < to.day) {
    months++;
  }

  return new FeelDuration(yearsMonthsDuration(months), true);
}


// extended range arithmetic /////////////////////////////////////////

/**
 * The year offset of a temporal instant (`0` for a <time>).
 */
function yearOffsetOf(temporal: FeelTemporal) : number {
  return isTime(temporal) ? 0 : temporal.yearOffset;
}

/**
 * Shift a date or date time by a number of years that is a multiple of
 * {@link CYCLE_YEARS}, returning `null` beyond the FEEL year range.
 */
function withYearOffset<T extends FeelDate | FeelDateTime>(temporal: T, years: number) : T | null {

  if (Math.abs(temporal.year + years) > MAX_FEEL_YEAR) {
    return null;
  }

  const yearOffset = temporal.yearOffset + years;

  return (isDate(temporal)
    ? new FeelDate(temporal.value, yearOffset)
    : new FeelDateTime(temporal.value, temporal.zone, yearOffset)
  ) as T;
}

/**
 * Whether adding a duration to a date or date time may leave the range
 * Temporal supports, i.e. needs to happen on a proxy.
 */
function needsExtendedArithmetic(temporal: FeelDate | FeelDateTime, dur: FeelDuration) : boolean {

  const { years, months, days } = dur.value;

  return (
    temporal.yearOffset !== 0 ||
    Math.abs(temporal.value.year) > MAX_ARITHMETIC_YEAR ||
    Math.abs(years * 12 + months) >= CYCLE_MONTHS ||
    Math.abs(days) >= CYCLE_DAYS
  );
}

/**
 * Add a duration to a date or date time beyond the range Temporal
 * supports: whole Gregorian cycles of the duration shift the year
 * offset, the remainder applies to a proxy in `[2000, 2400)`.
 */
function addDurationExtended(temporal: FeelDate | FeelDateTime, dur: FeelDuration, sign: number) : FeelTemporal | null {

  const d = dur.value;

  const months = d.years * 12 + d.months;

  const cycles = Math.trunc(months / CYCLE_MONTHS) + Math.trunc(d.days / CYCLE_DAYS);

  const rest = new FeelDuration(d.with({
    years: 0,
    months: months % CYCLE_MONTHS,
    days: d.days % CYCLE_DAYS
  }), dur.yearsMonths);

  const offset = cycleOffset(temporal.year);

  try {
    const proxy = withYearOffset(temporal, -offset);

    const result = addDuration(proxy, rest, sign);

    if (result === null || isTime(result)) {
      return result;
    }

    return withYearOffset(result, offset + sign * cycles * CYCLE_YEARS);
  } catch {

    // beyond the range of Temporal
    return null;
  }
}

/**
 * Subtract two temporal instants of which at least one is beyond the
 * range Temporal supports: subtract the proxies, then account for the
 * Gregorian cycles in between.
 */
function subtractTemporalsExtended(a: FeelTemporal, b: FeelTemporal) : FeelDuration | null {

  const aOffset = yearOffsetOf(a);
  const bOffset = yearOffsetOf(b);

  const proxy = (temporal: FeelTemporal, offset: number) => (
    isTime(temporal) ? temporal : withYearOffset(temporal, -offset)
  );

  const result = subtractTemporals(proxy(a, aOffset), proxy(b, bOffset));

  if (result === null) {
    return null;
  }

  try {
    const days = (aOffset - bOffset) / CYCLE_YEARS * CYCLE_DAYS;

    return new FeelDuration(result.value.add({ days }), result.yearsMonths);
  } catch {

    // beyond the range of a duration
    return null;
  }
}


// conversions ///////////////////////////////////////////////////////

function toPlainDateTime(temporal: FeelTemporal) : Temporal.PlainDateTime {

  if (isDate(temporal)) {
    return temporal.value.toPlainDateTime();
  }

  if (isDateTime(temporal)) {
    return temporal.value;
  }

  // time
  return REFERENCE_DATE.toPlainDateTime(temporal.value);
}

/**
 * Extract the calendar date of a date time.
 */
export function dateOf(dateTime: FeelDateTime) : FeelDate {
  return new FeelDate(dateTime.value.toPlainDate(), dateTime.yearOffset);
}

/**
 * Extract the time-of-day of a date time, preserving its time zone.
 */
export function timeOf(dateTime: FeelDateTime) : FeelTime {
  return new FeelTime(dateTime.value.toPlainTime(), dateTime.zone);
}

/**
 * The midnight (UTC) time of a date.
 */
export function timeOfDate(_date: FeelDate) : FeelTime {
  return new FeelTime(new Temporal.PlainTime(0, 0, 0), 'UTC');
}

/**
 * Combine a date (or the date part of a date time) with a time into a
 * date time, carrying over the time's zone.
 */
export function combine(date: FeelDate | FeelDateTime, time: FeelTime) : FeelDateTime {

  const datePart = isDate(date) ? date.value : date.value.toPlainDate();

  return new FeelDateTime(datePart.toPlainDateTime(time.value), time.zone, date.yearOffset);
}


// construction //////////////////////////////////////////////////////

/**
 * Construct a {@link FeelDate} from components, returning `null` for
 * invalid input.
 */
export function dateFrom(year: number, month: number, day: number) : FeelDate | null {

  const feelYear = Math.trunc(year);

  if (!(Math.abs(feelYear) <= MAX_FEEL_YEAR)) {
    return null;
  }

  const { year: proxyYear, offset } = splitYear(feelYear);

  try {
    return new FeelDate(Temporal.PlainDate.from({ year: proxyYear, month, day }, { overflow: 'reject' }), offset);
  } catch {
    return null;
  }
}

/**
 * Construct a {@link FeelTime} from components, returning `null` for
 * invalid input.
 *
 * An optional `offset` (a days and time duration) sets the time's zone,
 * e.g. `duration("PT5H")` yields a `+05:00` time.
 */
export function timeFrom(hour: number, minute: number, second: number, offset: FeelDuration | null = null) : FeelTime | null {
  try {

    // retain fractional seconds (up to nanosecond precision)
    let wholeSecond = Math.floor(second);
    let fraction = Math.round((second - wholeSecond) * 1e9);

    if (fraction === 1e9) {
      wholeSecond++;
      fraction = 0;
    }

    const value = Temporal.PlainTime.from({
      hour,
      minute,
      second: wholeSecond,
      millisecond: Math.trunc(fraction / 1e6),
      microsecond: Math.trunc(fraction / 1e3) % 1000,
      nanosecond: fraction % 1000
    }, { overflow: 'reject' });

    const zone = offset ? offsetZone(offset) : null;

    if (!isValidZone(zone)) {
      return null;
    }

    return new FeelTime(value, zone);
  } catch {
    return null;
  }
}

/**
 * Convert a days and time duration into a fixed-offset time zone
 * identifier, e.g. `+05:00`, `-01:00` or `+05:30:15`.
 */
function offsetZone(offset: FeelDuration) : string {

  const totalSeconds = Math.trunc(
    offset.value.total({ unit: 'second', relativeTo: REFERENCE_DATE })
  );

  const sign = totalSeconds < 0 ? '-' : '+';
  const abs = Math.abs(totalSeconds);

  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = abs % 60;

  const pad = (n: number) => String(n).padStart(2, '0');

  const base = `${sign}${pad(hours)}:${pad(minutes)}`;

  return seconds ? `${base}:${pad(seconds)}` : base;
}


// parsing ///////////////////////////////////////////////////////////

// the FEEL date grammar: a year of four to nine digits (no leading zeros
// beyond four digits), optionally negative, a month and a day
const DATE_PATTERN = /^(-?)(\d{4,9})-(\d{2})-(\d{2})$/;

// `24:00:00` denotes the end of a day (i.e. the start of the next day)
const END_OF_DAY_PATTERN = /^24:00:00(?:\.0+)?$/;

// characters that mark a zone designator (or annotation) left in the
// time part once the zone has been split off, e.g. in
// `10:00:00+01:00@Europe/Paris` or `10:00:00+05`
const ZONE_DESIGNATOR_PATTERN = /[+\-zZ[\]@]/;

/**
 * Parse a FEEL <date> string (`2020-01-01`, `-2017-12-31`,
 * `999999999-12-31`).
 *
 * Returns `null` if the input is not a valid date.
 */
export function parseDate(str: string) : FeelDate | null {

  const match = DATE_PATTERN.exec(str);

  if (!match) {
    return null;
  }

  const [ , sign, year, month, day ] = match;

  if (year.length > 4 && year.startsWith('0')) {
    return null;
  }

  return dateFrom((sign ? -1 : 1) * Number(year), Number(month), Number(day));
}

/**
 * Parse the time of day of a FEEL <time> string, with the zone split off.
 *
 * Returns whether the time denotes the end of a day (`24:00:00`, which
 * yields midnight), or `null` if the input is not a valid time.
 */
function parseTimeOfDay(str: string) : { value: Temporal.PlainTime, endOfDay: boolean } | null {

  // FEEL does not recognize leap seconds; a zone designator left after
  // splitting off the zone is either a second zone or malformed
  if (LEAP_SECOND_PATTERN.test(str) || ZONE_DESIGNATOR_PATTERN.test(str)) {
    return null;
  }

  if (END_OF_DAY_PATTERN.test(str)) {
    return {
      value: new Temporal.PlainTime(),
      endOfDay: true
    };
  }

  try {
    return {
      value: Temporal.PlainTime.from(str),
      endOfDay: false
    };
  } catch {
    return null;
  }
}

/**
 * Parse a FEEL <time> string (`10:30:00`, `10:30:00Z`,
 * `10:30:00+01:00`, `10:30:00@Europe/Paris`).
 */
export function parseTime(str: string) : FeelTime | null {

  const { value, zone } = splitZone(str);

  const time = parseTimeOfDay(value);

  if (!time || !isValidZone(zone)) {
    return null;
  }

  return new FeelTime(time.value, zone);
}

/**
 * Parse a FEEL <date and time> string (`2020-01-01T10:30:00`,
 * `...Z`, `...@Europe/Paris`).
 */
export function parseDateTime(str: string) : FeelDateTime | null {

  const separatorIndex = str.indexOf('T');

  // a date only denotes the start of the day
  if (separatorIndex === -1) {
    const { value, zone } = splitZone(str);

    const date = parseDate(value);

    if (!date || !isValidZone(zone)) {
      return null;
    }

    return new FeelDateTime(date.value.toPlainDateTime(), zone, date.yearOffset);
  }

  const date = parseDate(str.substring(0, separatorIndex));

  const { value, zone } = splitZone(str.substring(separatorIndex + 1));

  const time = parseTimeOfDay(value);

  if (!date || !time || !isValidZone(zone)) {
    return null;
  }

  let wallClock = date.value.toPlainDateTime(time.value);

  if (time.endOfDay) {
    wallClock = wallClock.add({ days: 1 });
  }

  const dateTime = new FeelDateTime(wallClock, zone, date.yearOffset);

  return Math.abs(dateTime.year) > MAX_FEEL_YEAR ? null : dateTime;
}


// public factories //////////////////////////////////////////////////

/**
 * Parse a FEEL date-ish string into the most specific temporal value:
 * a plain <date> or, if the string carries a time / zone, a
 * <date and time>.
 */
export function date(str: string) : FeelTemporal | null {

  if (str.includes('T')) {
    return parseDateTime(str);
  }

  return parseDate(str);
}

/**
 * Parse a FEEL <time> string into a {@link FeelTime}.
 */
export function time(str: string) : FeelTime | null {
  return parseTime(str);
}

/**
 * Parse a FEEL <date and time> string into a {@link FeelDateTime}.
 */
export function dateAndTime(str: string) : FeelDateTime | null {
  return parseDateTime(str);
}

/**
 * The current system date and time as a zoned value.
 */
export function now() : FeelDateTime {
  const zdt = Temporal.Now.zonedDateTimeISO();

  return new FeelDateTime(zdt.toPlainDateTime(), zdt.timeZoneId);
}

/**
 * The current system date.
 */
export function today() : FeelDate {
  return new FeelDate(Temporal.Now.plainDateISO());
}


// coercion //////////////////////////////////////////////////////////

/**
 * Coerce a raw temporal value into its FEEL wrapper.
 *
 * Accepts the wrapper types (returned as-is), native `Temporal` values
 * and native `Date` instances. Anything else is returned untouched.
 */
export function toFeel(value) {

  if (isDate(value) || isTime(value) || isDateTime(value) || isDuration(value)) {
    return value;
  }

  if (value instanceof Temporal.PlainDate) {
    return new FeelDate(value);
  }

  if (value instanceof Temporal.PlainTime) {
    return new FeelTime(value);
  }

  if (value instanceof Temporal.PlainDateTime) {
    return new FeelDateTime(value);
  }

  if (value instanceof Temporal.ZonedDateTime) {
    return new FeelDateTime(value.toPlainDateTime(), value.timeZoneId);
  }

  if (value instanceof Temporal.Duration) {
    return new FeelDuration(value);
  }

  if (value instanceof Date) {
    const zdt = Temporal.Instant
      .fromEpochMilliseconds(value.getTime())
      .toZonedDateTimeISO('UTC');

    return new FeelDateTime(zdt.toPlainDateTime(), 'UTC');
  }

  return value;
}
