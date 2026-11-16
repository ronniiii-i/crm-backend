import {
  CSV_NEWLINE,
  CsvWriter,
  UTF8_BOM,
  escapeCsvValue,
  formatCsvRow,
  guardFormula,
} from './csv-writer';

describe('csv writer', () => {
  describe('guardFormula', () => {
    it.each(['=1+1', '+SUM(A1)', '-2', '@cmd', '\tvalue', '\rvalue'])(
      'prefixes %j with an apostrophe',
      (value) => {
        expect(guardFormula(value)).toBe(`'${value}`);
      },
    );

    it('leaves ordinary text untouched', () => {
      expect(guardFormula('hello, world')).toBe('hello, world');
      expect(guardFormula('value = 1')).toBe('value = 1');
    });
  });

  describe('escapeCsvValue', () => {
    it('quotes cells containing commas, quotes and newlines', () => {
      expect(escapeCsvValue('a,b')).toBe('"a,b"');
      expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
      expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
      expect(escapeCsvValue('line1\r\nline2')).toBe('"line1\r\nline2"');
    });

    it('renders null and undefined as empty cells', () => {
      expect(escapeCsvValue(null)).toBe('');
      expect(escapeCsvValue(undefined)).toBe('');
    });

    it('serialises dates as ISO strings', () => {
      expect(escapeCsvValue(new Date('2026-11-06T10:15:00.000Z'))).toBe(
        '2026-11-06T10:15:00.000Z',
      );
      expect(escapeCsvValue(new Date('nope'))).toBe('');
    });

    it('never applies the formula guard to numbers', () => {
      expect(escapeCsvValue(-42)).toBe('-42');
      expect(escapeCsvValue(1.5)).toBe('1.5');
    });

    it('guards formula-shaped string cells before quoting', () => {
      expect(escapeCsvValue('=SUM(A1,A2)')).toBe(`"'=SUM(A1,A2)"`);
      expect(escapeCsvValue('@user')).toBe(`'@user`);
    });
  });

  describe('formatCsvRow', () => {
    it('joins cells with commas and ends with CRLF', () => {
      expect(formatCsvRow(['a', 1, true, null])).toBe(
        `a,1,true,${CSV_NEWLINE}`,
      );
    });
  });

  describe('CsvWriter', () => {
    it('emits the BOM exactly once before the header', () => {
      const writer = new CsvWriter();

      expect(writer.header(['Name', 'Amount'])).toBe(
        `${UTF8_BOM}Name,Amount${CSV_NEWLINE}`,
      );
      expect(writer.row(['Acme', 10])).toBe(`Acme,10${CSV_NEWLINE}`);
      expect(writer.row(['Beta', 20])).toBe(`Beta,20${CSV_NEWLINE}`);
    });

    it('starts with the BOM when no header is written', () => {
      const writer = new CsvWriter();

      expect(writer.row(['Acme'])).toBe(`${UTF8_BOM}Acme${CSV_NEWLINE}`);
      expect(writer.row(['Beta'])).toBe(`Beta${CSV_NEWLINE}`);
    });
  });
});
