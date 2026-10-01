import { COMMAND_ASSOCIATIONS } from '../config';

export interface Commenter {
  authorAssociation?: string;
  /** GitHub account type: "User" or "Bot". */
  userType?: string;
}

/**
 * Only maintainers may run Commands (ADR-0010): a comment on a public repo would otherwise
 * spend the owner's API quota. Bots are refused so EzPR's own replies can never trigger it.
 */
export function mayRunCommands(who: Commenter): boolean {
  if (who.userType === 'Bot') return false;
  return (COMMAND_ASSOCIATIONS as readonly string[]).includes(who.authorAssociation ?? '');
}
