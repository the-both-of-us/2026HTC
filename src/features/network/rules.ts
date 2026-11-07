/**
 * Profile field rules, as plain functions with no store or server access, so the join form
 * can check the same rules before it sends anything.
 */
import type { CleanProfile, ProfileInput } from "./types";

export const MAX_NAME_LENGTH = 40;
export const MAX_CITY_LENGTH = 40;
export const MAX_LOOKING_FOR_LENGTH = 120;
export const MAX_CONTACT_LENGTH = 200;
/** The name on OryxLearn's own sample courses. Nobody can join under it. */
const RESERVED_NAME = "OryxLearn team";

export type ProfileField = keyof CleanProfile;
export type ProfileErrors = Partial<Record<ProfileField, string>>;
export type ProfileCheck = { ok: true; value: CleanProfile } | { ok: false; errors: ProfileErrors };

/** Control characters become spaces, runs of whitespace one space, and the ends are trimmed. */
export function cleanText(input: string | null | undefined): string {
  return (input ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Count characters, not UTF-16 units, so an emoji counts as one. */
function length(text: string): number {
  return [...text].length;
}

/** Lower case letters and digits only, so "Oryx Learn-Team" and "oryxlearn team" compare equal. */
function nameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function checkName(input: string | null | undefined): { value: string } | { error: string } {
  const name = cleanText(input);
  if (!/[\p{L}\p{N}]/u.test(name)) return { error: "Please enter the name to show on your profile." };
  if (length(name) > MAX_NAME_LENGTH) {
    return { error: `Please keep the name to ${MAX_NAME_LENGTH} characters or fewer.` };
  }
  if (nameKey(name) === nameKey(RESERVED_NAME)) {
    return { error: "That name is kept for OryxLearn's own sample courses. Please choose a different name." };
  }
  return { value: name };
}

function checkOptional(
  input: string | null | undefined,
  max: number,
  what: string,
): { value: string } | { error: string } {
  const text = cleanText(input);
  if (length(text) > max) return { error: `Please keep ${what} to ${max} characters or fewer.` };
  return { value: text };
}

/**
 * The contact link: empty means none. Only a whole https URL is accepted, so a
 * `javascript:`, `data:` or plain `http:` link can never be put on someone's card.
 * Returns the URL as the browser would write it.
 */
export function checkContactUrl(input: string | null | undefined): { value: string | null } | { error: string } {
  const text = (input ?? "").trim();
  if (!text) return { value: null };
  const notHttps = "Please use a link that starts with https://, such as your LinkedIn page.";
  if (text.length > MAX_CONTACT_LENGTH) {
    return { error: `Please keep the link to ${MAX_CONTACT_LENGTH} characters or fewer.` };
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: notHttps };
  }
  if (url.protocol !== "https:" || !url.hostname) return { error: notHttps };
  // A name and password in a link only ever serve to disguise where it goes.
  if (url.username || url.password) return { error: "Please use a link without a name or password in it." };
  const href = url.href;
  if (href.length > MAX_CONTACT_LENGTH) {
    return { error: `Please keep the link to ${MAX_CONTACT_LENGTH} characters or fewer.` };
  }
  return { value: href };
}

/** Cleans every field, or says what is wrong with each one that can't be used. */
export function checkProfileInput(input: ProfileInput): ProfileCheck {
  const name = checkName(input.displayName);
  const city = checkOptional(input.city, MAX_CITY_LENGTH, "the city");
  const lookingFor = checkOptional(input.lookingFor, MAX_LOOKING_FOR_LENGTH, `"Looking for"`);
  const contact = checkContactUrl(input.contactUrl);

  const errors: ProfileErrors = {};
  if ("error" in name) errors.displayName = name.error;
  if ("error" in city) errors.city = city.error;
  if ("error" in lookingFor) errors.lookingFor = lookingFor.error;
  if ("error" in contact) errors.contactUrl = contact.error;
  if ("error" in name || "error" in city || "error" in lookingFor || "error" in contact) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: { displayName: name.value, city: city.value, lookingFor: lookingFor.value, contactUrl: contact.value },
  };
}

/** The first problem, in form order, for a single error sentence. */
export function firstError(errors: ProfileErrors): string {
  const order: ProfileField[] = ["displayName", "city", "lookingFor", "contactUrl"];
  for (const field of order) {
    const error = errors[field];
    if (error) return error;
  }
  return "Please check the profile and try again.";
}
