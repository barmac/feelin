import { expect } from './helpers.js';

import { Temporal } from 'temporal-polyfill';

import {
  evaluate,
  date,
  time,
  dateAndTime,
  duration,
  now,
  today,
  toFeel,
  FeelDate,
  FeelTime,
  FeelDateTime,
  FeelDuration
} from 'feelin';


describe('temporal', function() {

  describe('public API', function() {

    it('should expose temporal factories', function() {
      expect(date).to.be.a('function');
      expect(time).to.be.a('function');
      expect(dateAndTime).to.be.a('function');
      expect(duration).to.be.a('function');
      expect(now).to.be.a('function');
      expect(today).to.be.a('function');
      expect(toFeel).to.be.a('function');
    });


    it('should expose wrapper classes', function() {
      expect(date('2020-04-06')).to.be.an.instanceof(FeelDate);
      expect(time('10:30:00')).to.be.an.instanceof(FeelTime);
      expect(dateAndTime('2020-04-06T10:30:00')).to.be.an.instanceof(FeelDateTime);
      expect(duration('P1D')).to.be.an.instanceof(FeelDuration);
    });


    it('should return wrapper values from evaluate', function() {
      expect(evaluate('date("2020-04-06")').value).to.be.an.instanceof(FeelDate);
      expect(evaluate('time("10:30:00")').value).to.be.an.instanceof(FeelTime);
      expect(evaluate('date and time("2020-04-06T10:30:00")').value).to.be.an.instanceof(FeelDateTime);
      expect(evaluate('duration("P1D")').value).to.be.an.instanceof(FeelDuration);
    });

  });


  describe('unwrap()', function() {

    it('should unwrap a date to Temporal.PlainDate', function() {
      const value = evaluate('date("2020-04-06")').value;

      expect(value.unwrap()).to.be.an.instanceof(Temporal.PlainDate);
      expect(value.unwrap().toString()).to.eql('2020-04-06');
    });


    it('should unwrap a time to Temporal.PlainTime', function() {
      const value = evaluate('time("10:30:00")').value;

      expect(value.unwrap()).to.be.an.instanceof(Temporal.PlainTime);
      expect(value.unwrap().toString()).to.eql('10:30:00');
    });


    it('should unwrap a date and time to Temporal.PlainDateTime', function() {
      const value = evaluate('date and time("2020-04-06T10:30:00")').value;

      expect(value.unwrap()).to.be.an.instanceof(Temporal.PlainDateTime);
      expect(value.unwrap().toString()).to.eql('2020-04-06T10:30:00');
    });


    it('should unwrap a duration to Temporal.Duration', function() {
      const value = evaluate('duration("P1D")').value;

      expect(value.unwrap()).to.be.an.instanceof(Temporal.Duration);
    });

  });


  describe('serialization', function() {

    it('should serialize to the canonical ISO form', function() {
      expect(JSON.stringify(date('2020-04-06'))).to.eql('"2020-04-06"');
      expect(JSON.stringify(time('10:30:00'))).to.eql('"10:30:00"');
      expect(JSON.stringify(dateAndTime('2020-04-06T10:30:00'))).to.eql('"2020-04-06T10:30:00"');
      expect(JSON.stringify(duration('P1Y2M'))).to.eql('"P1Y2M"');
    });


    it('should serialize zoned values with their zone', function() {
      expect(JSON.stringify(time('10:30:00+05:00'))).to.eql('"10:30:00+05:00"');
      expect(JSON.stringify(dateAndTime('2020-04-06T10:30:00Z'))).to.eql('"2020-04-06T10:30:00Z"');
    });


    it('should serialize a zero years and months duration category-aware', function() {
      expect(JSON.stringify(duration('P0M'))).to.eql('"P0M"');
    });

  });


  describe('value range', function() {

    // FEEL supports years in [-999,999,999..999,999,999], way beyond the
    // range of Temporal (about ±271,821 years)

    verify('date("-2017-12-31")', '-2017-12-31');
    verify('date("-2017-01-01")', '-2017-01-01');
    verify('date(-2017, 12, 31)', '-2017-12-31');
    verify('date("0000-12-25")', '0000-12-25');
    verify('date(-1, 1, 1)', '-0001-01-01');
    verify('date("99999-12-31")', '99999-12-31');
    verify('date("999999999-12-31")', '999999999-12-31');
    verify('date("-999999999-12-31")', '-999999999-12-31');
    verify('date(999999999, 12, 31)', '999999999-12-31');
    verify('date(-999999999, 12, 31)', '-999999999-12-31');

    verify('date and time("-2017-12-31T11:22:33")', '-2017-12-31T11:22:33');
    verify('date and time("-2017-12-31T11:22:33.456+01:35")', '-2017-12-31T11:22:33.456+01:35');
    verify('date and time("99999-12-31T11:22:33")', '99999-12-31T11:22:33');
    verify('date and time("-99999-12-31T11:22:33")', '-99999-12-31T11:22:33');
    verify('date and time("999999999-12-31T23:59:59.999999999@Europe/Paris")', '999999999-12-31T23:59:59.999999999@Europe/Paris');
    verify('date and time("-999999999-12-31T23:59:59.999999999+02:00")', '-999999999-12-31T23:59:59.999999999+02:00');
    verify('date and time(date("999999999-12-31"), time("10:00:00Z"))', '999999999-12-31T10:00:00Z');
    verify('date(date and time("-999999999-12-31T10:00:00"))', '-999999999-12-31');

    verify('string(date("999999999-12-31"))', '999999999-12-31');
    verify('string(date and time("-2017-12-31T11:22:33"))', '-2017-12-31T11:22:33');

    verify('date("999999999-12-31").year', 999999999);
    verify('date("-999999999-01-01").year', -999999999);
    verify('date("999999999-12-31").month', 12);
    verify('date("999999999-12-31").day', 31);
    verify('date and time("999999999-12-31T10:00:00").year', 999999999);

    // the proxy shares leap years, weekdays and days of year
    verify('date("400004-02-29")', '400004-02-29');
    verify('date("400100-02-29")', null);
    verify('date("400001-02-29")', null);
    verify('date("2017-12-31").weekday = date("400017-12-31").weekday', true);
    verify('day of year(date("400016-12-31"))', 366);
    verify('day of week(date("999999999-12-31"))', 'Friday');

    verify('date("999999999-12-31") = date(999999999, 12, 31)', true);
    verify('date("999999999-12-31") > date("999999999-12-30")', true);
    verify('date("-999999999-12-31") < date("2017-01-01")', true);
    verify('date("500000-01-01") > date("100000-01-01")', true);
    verify('date and time("999999999-12-31T10:00:00Z") = date and time("999999999-12-31T11:00:00+01:00")', true);

    verify('date("9999999999-12-25")', null);
    verify('date(-1000999999, 12, 1)', null);
    verify('date(1000999999, 12, 1)', null);
    verify('date("+2012-12-02")', null);
    verify('date("01211-12-31")', null);
    verify('date("998-12-31")', null);
    verify('date("2012-12-25T")', null);

    verify('years and months duration(date and time("-2016-01-30T09:05:00"), date and time("-2017-02-28T02:02:02"))', '-P11M');
    verify('years and months duration(date and time("2014-12-31T23:59:59"), date and time("-2019-10-01T12:32:59"))', '-P4033Y2M');
    verify('years and months duration(date("2011-12-22"), date("2013-08-24"))', 'P1Y8M');
    verify('years and months duration(date("2017-01-31"), date("2017-02-28"))', 'P0M');
    verify('years and months duration(date("-999999999-01-01"), date("999999999-01-01"))', 'P1999999998Y');
    verify('years and months duration(date("2017-01-01"), date("999999999-01-31"))', 'P999997982Y');

    verify('date("999999999-12-31") + duration("P1D")', null);
    verify('date("999999999-12-30") + duration("P1D")', '999999999-12-31');
    verify('date("-999999999-12-31") - duration("P1Y")', null);
    verify('date("2017-01-01") + duration("P999999999Y")', null);
    verify('date("2017-01-01") + duration("P99999999Y")', '100002016-01-01');
    verify('date("100002016-01-01") - duration("P99999999Y")', '2017-01-01');
    verify('date("2017-03-31") + duration("P400000Y1M")', '402017-04-30');
    verify('date("2017-01-01") + duration("P999999999D")', '2739924-01-04');
    verify('date and time("999999999-12-31T10:00:00@Europe/Paris") + duration("PT1H")', '999999999-12-31T11:00:00@Europe/Paris');
    verify('date("999999999-12-31") - date("999999999-12-01")', 'P30D');
    verify('date("500000-01-01") - date("2017-01-01")', 'P181884555D');

    verify('abs(date("-2018-12-06"))', null, [ 'abs(n) expects a number or duration, got \'-2018-12-06\'' ]);

  });


  describe('parsing', function() {

    // offsets beyond ±18:00
    verify('time("13:20:00+18:00")', '13:20:00+18:00');
    verify('time("13:20:00+19:00")', null);
    verify('time("13:20:00-19:00")', null);
    verify('time("13:20:00+18:00:01")', null);
    verify('date and time("2017-12-31T13:20:00+19:00")', null);
    verify('date and time("2017-12-31T13:20:00-19:00")', null);
    verify('time(11, 59, 45, duration("PT19H"))', null);

    // offset and zone together
    verify('time("13:20:00+02:00@Europe/Paris")', null);
    verify('date and time("2017-12-31T13:20:00+02:00@Europe/Paris")', null);
    verify('date and time("2011-12-03T10:15:30+01:00@Europe/Paris")', null);
    verify('time("13:20:00Z@Europe/Paris")', null);

    // unsupported zone designators
    verify('time("13:20:00+05")', null);
    verify('date and time("2017-12-31T11:22:33[Europe/Paris]")', null);

    // end of day
    verify('@"2021-01-01T24:00:00"', '2021-01-02T00:00:00');
    verify('date and time("2021-12-31T24:00:00Z")', '2022-01-01T00:00:00Z');
    verify('date and time("-2017-12-31T24:00:00")', '-2016-01-01T00:00:00');
    verify('date and time("999999999-12-31T24:00:00")', null);
    verify('time("24:00:00")', '00:00:00');
    verify('date and time("2017-12-31T24:00:01")', null);
    verify('date and time("2017-12-31T24:01:00")', null);

    // fractional seconds
    verify('time(12, 59, 1.3, duration("-PT1H"))', '12:59:01.3-01:00');
    verify('time(12, 59, 1.3)', '12:59:01.3');
    verify('time(12, 59, 1.987654321)', '12:59:01.987654321');

    // durations
    verify('duration("PT0.S")', 'PT0S');
    verify('duration("PT1.S")', 'PT1S');
    verify('duration("PT.5S")', null);
    verify('duration("P999999999M")', 'P83333333Y3M');
    verify('duration("-P999999999M")', '-P83333333Y3M');
    verify('duration("P99999999Y")', 'P99999999Y');
    verify('duration("-P99999999Y")', '-P99999999Y');
    verify('duration("P999999999D")', 'P999999999D');
    verify('duration("P999999999M") = duration("P83333333Y3M")', true);
    verify('duration("P999999999M") > duration("P1Y")', true);
    verify('duration("P99999999Y") + duration("P1Y")', 'P100000000Y');
    verify('duration("P999999999D") = duration("P999999999D")', true);

  });


  describe('toFeel()', function() {

    it('should wrap a JS Date as a UTC date and time', function() {
      const value = toFeel(new Date('2020-04-06T10:30:00Z'));

      expect(value).to.be.an.instanceof(FeelDateTime);
      expect(value.toString()).to.eql('2020-04-06T10:30:00Z');
    });


    it('should wrap raw Temporal values', function() {
      expect(toFeel(Temporal.PlainDate.from('2020-04-06'))).to.be.an.instanceof(FeelDate);
      expect(toFeel(Temporal.PlainTime.from('10:30:00'))).to.be.an.instanceof(FeelTime);
      expect(toFeel(Temporal.PlainDateTime.from('2020-04-06T10:30:00'))).to.be.an.instanceof(FeelDateTime);
      expect(toFeel(Temporal.Duration.from('P1D'))).to.be.an.instanceof(FeelDuration);
    });


    it('should pass wrappers through unchanged', function() {
      const wrapped = date('2020-04-06');

      expect(toFeel(wrapped)).to.equal(wrapped);
    });


    it('should leave non-temporal values untouched', function() {
      expect(toFeel(42)).to.eql(42);
      expect(toFeel('foo')).to.eql('foo');
      expect(toFeel(null)).to.eql(null);
    });

  });


  describe('context coercion', function() {

    it('should coerce a JS Date in the context', function() {
      const output = evaluate('a = date and time("2020-04-06T10:30:00Z")', {
        a: new Date('2020-04-06T10:30:00Z')
      });

      expect(output.value).to.be.true;
    });


    it('should coerce a raw Temporal.PlainDate in the context', function() {
      const output = evaluate('a = date("2020-04-06")', {
        a: Temporal.PlainDate.from('2020-04-06')
      });

      expect(output.value).to.be.true;
    });


    it('should coerce a raw Temporal.PlainTime in the context', function() {
      const output = evaluate('a = time("10:30:00")', {
        a: Temporal.PlainTime.from('10:30:00')
      });

      expect(output.value).to.be.true;
    });


    it('should coerce a raw Temporal.Duration in the context', function() {
      const output = evaluate('a = duration("P1D")', {
        a: Temporal.Duration.from('P1D')
      });

      expect(output.value).to.be.true;
    });


    it('should coerce nested context entries', function() {
      const output = evaluate('a.b = date("2020-04-06")', {
        a: { b: Temporal.PlainDate.from('2020-04-06') }
      });

      expect(output.value).to.be.true;
    });


    it('should coerce values inside lists', function() {
      const output = evaluate('a[1] = date("2020-04-06")', {
        a: [ Temporal.PlainDate.from('2020-04-06') ]
      });

      expect(output.value).to.be.true;
    });


    it('should allow property access on coerced values', function() {
      const output = evaluate('a.year', {
        a: Temporal.PlainDate.from('2020-04-06')
      });

      expect(output.value).to.eql(2020);
    });

  });

});


// helpers ///////////////

/**
 * Verify that an expression evaluates to the expected value, comparing
 * temporal values by their string form; nothing may throw.
 */
function verify(expression, expected, expectedWarnings) {

  it(`${ expression } => ${ expected }`, function() {

    const { value, warnings } = evaluate(expression);

    const actual = value && typeof value === 'object' ? value.toString() : value;

    expect(actual).to.eql(expected);

    if (expectedWarnings) {
      expect(warnings.map(w => w.message)).to.eql(expectedWarnings);
    }
  });
}
