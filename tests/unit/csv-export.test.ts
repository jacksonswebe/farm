import { describe, expect, it } from 'vitest';

/**
 * The CSV quoting rules, tested directly.
 *
 * A description field is free text a reporter types. If it starts with =, +,
 * - or @, Excel evaluates it as a formula when the customer opens the export
 * — so a hazard report can become a phishing link inside the safety team's
 * own spreadsheet. Every exported cell is prefixed with a quote in that case.
 */
function csvCell(value: unknown): string {
  if (value == null) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

describe('csv cell encoding', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx'])('neutralises a formula starting %s', (v) => {
    expect(csvCell(v).startsWith("'")).toBe(true);
  });

  it('quotes and escapes embedded quotes', () => {
    expect(csvCell('he said "stop"')).toBe('"he said ""stop"""');
  });

  it('quotes a field containing a comma', () => {
    expect(csvCell('Dar es Salaam, Tanzania')).toBe('"Dar es Salaam, Tanzania"');
  });

  it('quotes a field containing a newline', () => {
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
  });

  it('leaves ordinary text alone', () => {
    expect(csvCell('Scaffold plank failed')).toBe('Scaffold plank failed');
  });

  it('renders null and undefined as empty, never as the words', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('handles the combined case: a formula that also contains a comma', () => {
    const out = csvCell('=HYPERLINK("http://evil","click"), now');
    expect(out.startsWith('"\'=')).toBe(true);
    expect(out).toContain('""');
  });
});
