import { describe, expect, it } from 'vitest';
import { changedSymbols, symbolsOf } from '../src/context/symbols';

describe('changedSymbols', () => {
  it('finds TS declarations on added and removed lines only', () => {
    const patch = [
      '@@ -1,4 +1,4 @@',
      ' export function untouched() {}',
      '-export function oldName(a: number) {',
      '+export async function newName(a: number) {',
      '+export const handler = () => 1;',
      '+class Widget {',
      '+  render(props: P): void {',
    ].join('\n');
    expect(changedSymbols('a.ts', patch).sort()).toEqual(
      ['Widget', 'handler', 'newName', 'oldName', 'render'].sort(),
    );
  });

  it('skips control-flow lines, short and generic names', () => {
    const patch = '+  if (x) {\n+function run() {}\n+const id = 1;\n+function init() {}';
    expect(changedSymbols('a.ts', patch)).toEqual([]);
  });

  it('understands Python and C', () => {
    expect(changedSymbols('a.py', '+def compute_total(x):\n+class Cart:')).toEqual([
      'compute_total',
      'Cart',
    ]);
    expect(changedSymbols('a.c', '+static int parse_header(const char *s)')).toContain(
      'parse_header',
    );
  });

  it('caps and dedupes across files', () => {
    const many = Array.from({ length: 30 }, (_, i) => `+function name${i}x() {`).join('\n');
    expect(symbolsOf([{ path: 'a.ts', patch: many }])).toHaveLength(10);
  });
});
