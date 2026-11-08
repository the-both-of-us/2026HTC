import { listPublicPrograms } from "@/features/programs";
import { errorResponse } from "@/shared/http";

/** `{ programs }`: every public program, newest first. `?q=` matches title, summary or author. Anyone can read it. */
export async function GET(request: Request) {
  try {
    const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 1000);
    return Response.json({ programs: await listPublicPrograms({ q }) });
  } catch (error) {
    return errorResponse(error, "The programs could not be loaded this time. Please try again.");
  }
}
