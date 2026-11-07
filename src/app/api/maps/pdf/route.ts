import { generatePdfSkillMap } from "@/features/skill-map";
import { getUserId } from "@/shared/identity";
import { mapErrorResponse } from "../errors";

// Reading the PDF is quick. The model call is the long part, as for a posting.
export const maxDuration = 120;

/** Builds a map from a PDF sent as form data, in a field named `file`. */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose a PDF file first, then try again." }, { status: 400 });
  }

  try {
    const ownerId = await getUserId();
    const map = await generatePdfSkillMap({ file: new Uint8Array(await file.arrayBuffer()), ownerId });
    return Response.json({ id: map.id }, { status: 201 });
  } catch (error) {
    return mapErrorResponse(error);
  }
}
