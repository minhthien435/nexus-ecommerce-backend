import { describe, expect, it } from 'vitest';
import { parseCsv } from './parser.js';

describe('parseCsv', () => {
  it('parses quoted commas and escaped quotes', () => {
    expect(parseCsv('id,name\n1,"Phone, Pro"\n2,"A ""quoted"" name"')).toEqual([
      { id: '1', name: 'Phone, Pro' },
      { id: '2', name: 'A "quoted" name' },
    ]);
  });
  it('rejects an unclosed quoted field', () =>
    expect(() => parseCsv('id,name\n1,"bad')).toThrow('CSV_UNCLOSED_QUOTE'));
});
