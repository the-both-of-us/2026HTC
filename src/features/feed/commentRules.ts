/**
 * The rules a comment must pass before the AI check, as pure functions the browser can run too.
 * Some learners are kids, so links, contact details and abuse are refused outright.
 */
export const MAX_COMMENT_LENGTH = 280;

/** Whitespace collapsed, ends trimmed. */
export function cleanComment(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

const LINK = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|org|net|io|ca|co|me|ly|gg|app|dev|xyz|tv)\b/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
/** Ten or more digits with phone separators, or a 555-1234 shape. Year ranges like 1914-1918 pass. */
const PHONE = /(?:\+?\d[\s().-]*){10,}|\b\d{3}[\s.-]\d{4}\b/;
/** Contact asks that skip a link: handles and "add me on". */
const CONTACT = /(^|\s)@[a-z0-9_.]{3,}|\b(add|dm|text|message|follow) me\b|\b(snap(chat)?|insta(gram)?|discord|whatsapp|telegram|kik)\b/i;
/** Slurs and obvious abuse. The AI check catches subtler cases. */
const BLOCKED =
  /\b(f+u+c+k+\w*|sh[i1]t+\w*|b[i1]tch\w*|c+u+n+t+\w*|puss(y|ies)|asshole\w*|bastard\w*|wh[o0]re\w*|slut\w*|fag(s|got\w*)?|n[i1]gg\w*|retard\w*|tranny|kys|kill (yo)?urself|go die|porn\w*|nude\w*|sexy|hentai)\b/i;

/** Why a comment cannot be posted, as a sentence for the learner, or null when the rules pass. */
export function commentProblem(raw: string): string | null {
  const text = cleanComment(raw);
  if (text.length === 0) return "Write something first.";
  if (text.length > MAX_COMMENT_LENGTH) return `Keep it to ${MAX_COMMENT_LENGTH} characters. This one is ${text.length}.`;
  if (EMAIL.test(text)) return "Comments can't include email addresses. Keep contact details private.";
  if (LINK.test(text)) return "Comments can't include links.";
  if (PHONE.test(text)) return "Comments can't include phone numbers or long numbers. Keep contact details private.";
  if (CONTACT.test(text)) return "Comments can't ask people to contact you elsewhere.";
  if (BLOCKED.test(text)) return "That comment has words we don't allow here. Keep it kind.";
  if (!/\p{L}/u.test(text)) return "Write a comment in words.";
  return null;
}
