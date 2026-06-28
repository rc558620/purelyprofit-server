import { escapeCsvField, toCsvLine } from './stream-export.utils';

describe('stream-export.utils', () => {
  describe('escapeCsvField', () => {
    it('returns empty string for null', () => {
      expect(escapeCsvField(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(escapeCsvField(undefined)).toBe('');
    });

    it('returns string representation for numbers', () => {
      expect(escapeCsvField(42)).toBe('42');
    });

    it('returns plain string as-is when no special chars', () => {
      expect(escapeCsvField('hello')).toBe('hello');
    });

    it('escapes field with comma', () => {
      expect(escapeCsvField('a,b')).toBe('"a,b"');
    });

    it('escapes field with double quote', () => {
      expect(escapeCsvField('say "hello"')).toBe('"say ""hello"""');
    });

    it('escapes field with newline', () => {
      expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    });

    it('escapes field with comma and double quote', () => {
      expect(escapeCsvField('a,"b",c')).toBe('"a,""b"",c"');
    });
  });

  describe('toCsvLine', () => {
    it('joins values with comma and ends with CRLF', () => {
      expect(toCsvLine([1, 'hello', true])).toBe('1,hello,true\r\n');
    });

    it('handles values needing escaping', () => {
      expect(toCsvLine(['a,b', 'hello'])).toBe('"a,b",hello\r\n');
    });

    it('handles empty array', () => {
      expect(toCsvLine([])).toBe('\r\n');
    });

    it('handles null and undefined values', () => {
      expect(toCsvLine([null, undefined, 'x'])).toBe(',,x\r\n');
    });
  });
});
