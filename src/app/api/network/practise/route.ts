import { findCoursesHref, findPractiseLink } from "@/features/network";
import { getUserId } from "@/shared/identity";

/**
 * "Practise this" on People: GET ?skill=<title> redirects to that skill on your own map,
 * or to courses that teach it if none of your maps has it. The map id only ever appears
 * in this redirect, to its owner, so the People data never carries one.
 */
export async function GET(request: Request) {
  const skill = new URL(request.url).searchParams.get("skill") ?? "";
  let href = findCoursesHref(skill);
  try {
    href = (await findPractiseLink(await getUserId(), skill)) ?? href;
  } catch (error) {
    // A failed lookup still lands somewhere useful: the courses that teach this skill.
    console.error("[network] practise lookup failed", error);
  }
  return Response.redirect(new URL(href, request.url), 303);
}
