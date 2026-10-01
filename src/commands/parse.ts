export const COMMAND_NAMES = ['review', 'explain', 'ignore'] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

export type ParsedCommand =
  { kind: 'command'; name: CommandName } | { kind: 'unknown'; word: string };

const FENCE = /^\s{0,3}(```|~~~)/;
const MENTION = /^\s{0,3}@ezpr(?![\w-])\s*(\S*)/i;

/**
 * The Command in a comment, if any. Only the first `@ezpr` at the start of a line counts;
 * quoted lines (`>`) and code fences are skipped so a quoted reply cannot re-trigger it, and
 * text after the command word is ignored.
 */
export function parseCommand(body: string): ParsedCommand | null {
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || /^\s*>/.test(line)) continue;
    const m = MENTION.exec(line);
    if (!m) continue;
    const word = (m[1] ?? '').toLowerCase();
    const name = COMMAND_NAMES.find((n) => n === word);
    return name ? { kind: 'command', name } : { kind: 'unknown', word };
  }
  return null;
}
