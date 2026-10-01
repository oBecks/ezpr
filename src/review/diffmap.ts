const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Lines of the new file that a review comment can attach to, with their text: every added
 * line and every context line inside a hunk of the patch. Anything else is outside the diff.
 */
export function parseDiffTexts(patch: string): Map<number, string> {
  const texts = new Map<number, string>();
  let oldLeft = 0;
  let newLeft = 0;
  let newLine = 0;

  for (const line of patch.split('\n')) {
    const header = HUNK.exec(line);
    if (header) {
      oldLeft = Number(header[2] ?? 1);
      newLeft = Number(header[4] ?? 1);
      newLine = Number(header[3]);
      continue;
    }
    if (oldLeft <= 0 && newLeft <= 0) continue;
    const kind = line[0];
    if (kind === '+') {
      texts.set(newLine++, line.slice(1));
      newLeft--;
    } else if (kind === '-') {
      oldLeft--;
    } else if (kind === ' ' || line === '') {
      texts.set(newLine++, line.slice(1));
      newLeft--;
      oldLeft--;
    }
    // "\ No newline at end of file" and anything else consume no lines.
  }
  return texts;
}

/** Lines of the new file that a review comment can attach to. */
export function parseDiffLines(patch: string): Set<number> {
  return new Set(parseDiffTexts(patch).keys());
}

/** Text of every line a review comment can attach to, per file. */
export function diffLineTexts(
  files: { path: string; patch?: string }[],
): Map<string, Map<number, string>> {
  const map = new Map<string, Map<number, string>>();
  for (const f of files) {
    if (f.patch) map.set(f.path, parseDiffTexts(f.patch));
  }
  return map;
}

export function diffLineMap(files: { path: string; patch?: string }[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const f of files) {
    if (f.patch) map.set(f.path, parseDiffLines(f.patch));
  }
  return map;
}
