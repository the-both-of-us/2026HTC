import { commentBody, deleteComment, deleteCommentBody, listComments, postComment } from "@/features/feed";
import { errorResponse, HttpError, parseBody } from "@/shared/http";
import { getSession, getUserId, readUserId } from "@/shared/identity";

/** The newest 50 public comments on a card or Short: GET /api/feed/comments?itemId=<id>. */
export async function GET(request: Request) {
  try {
    const itemId = new URL(request.url).searchParams.get("itemId") ?? "";
    if (itemId.length < 3 || itemId.length > 90) throw new HttpError("We could not find that card. Please refresh the feed.", 404);
    return Response.json({ comments: await listComments(itemId, await readUserId()) });
  } catch (error) {
    return errorResponse(error, "Comments could not be loaded just now. Please try again.");
  }
}

/** Posts a comment after the rules, the rate limit and one AI check. Signed-in viewers comment under their name. */
export async function POST(request: Request) {
  try {
    const { itemId, text } = await parseBody(request, commentBody);
    const userId = await getUserId();
    const session = await getSession();
    const displayName = session.signedIn && session.userId === userId ? session.displayName : null;
    return Response.json({ comment: await postComment(userId, displayName, itemId, text) });
  } catch (error) {
    return errorResponse(error, "That comment did not post. Please try again.");
  }
}

/** Deletes one of the viewer's own comments. */
export async function DELETE(request: Request) {
  try {
    const { itemId, commentId } = await parseBody(request, deleteCommentBody);
    const userId = await readUserId();
    if (!userId) throw new HttpError("We could not find that comment. It may already be deleted.", 404);
    await deleteComment(userId, itemId, commentId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, "That comment could not be deleted. Please try again.");
  }
}
