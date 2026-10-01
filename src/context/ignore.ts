/** Parses the `ignore` action input: one glob per line, blank lines and `#` comments dropped. */
export function parseIgnore(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function globToSource(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === '*') {
      if (glob.charAt(i + 1) === '*') {
        i++;
        if (glob.charAt(i + 1) === '/') {
          i++;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return out;
}

/**
 * Builds a path matcher from gitignore-like globs. A pattern without a slash matches that
 * name at any depth; one with a slash is anchored at the repo root. A match on a directory
 * ignores everything below it.
 */
export function makeIgnore(patterns: string[]): (path: string) => boolean {
  const res = patterns.map((raw) => {
    let p = raw.replace(/^\/+/, '');
    if (p.endsWith('/')) p = p.slice(0, -1);
    const anchored = p.includes('/');
    return new RegExp(`${anchored ? '^' : '(?:^|/)'}${globToSource(p)}(?:/|$)`);
  });
  return (path) => res.some((r) => r.test(path));
}
