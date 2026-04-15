/**
 * Basic profanity wordlist for review filtering.
 * Used for initial flagging; manual moderation still required.
 */
export const PROFANITY_LIST = [
  'badword1',
  'badword2',
  'offensive',
  'vulgar',
  'inappropriate',
  // Add more as needed
];

export function containsProfanity(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return PROFANITY_LIST.some((word) => lower.includes(word));
}
