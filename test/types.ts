import {
  evaluate,
  unaryTest,
  ExternalFunctionHandler
} from '..';

import { expect } from 'chai';


describe('types', function() {

  describe('evaluate', function() {

    it('should evaluate', function() {

      // when
      const { value, warnings } = evaluate('hello', {
        hello: 'HELLO'
      });

      // then
      expect(value).to.eql('HELLO');
      expect(warnings).to.eql([]);
    });


    it('should evaluate with external function handler', function() {

      // given
      const externalFunctionHandler: ExternalFunctionHandler = ({ mapping, parameterNames }) => {
        return mapping && parameterNames.length === 2 ? Math.max : null;
      };

      // when
      const { value } = evaluate('(function(a, b) external { js: "max" })(1, 2)', {}, undefined, {
        externalFunctionHandler
      });

      // then
      expect(value).to.eql(2);
    });

  });


  describe('unaryTest', function() {

    it('should test', function() {

      // when
      const { value, warnings } = unaryTest('[10, 20]', {
        '?': 5
      });

      // then
      expect(value).to.be.false;
      expect(warnings).to.be.an('array');
    });

  });

});