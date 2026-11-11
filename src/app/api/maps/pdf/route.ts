import { AiRefusedError } from "@/features/ai";
import { writeFirstLessonSoon } from "@/features/lessons";
import { generatePdfSkillMap } from "@/features/skill-map";
import { getUserId } from "@/shared/identity";
import { mapErrorResponse } from "../errors";

// Reading the PDF is quick. The model call is the long part, as for a posting.
export const maxDuration = 120;

/** Builds one private map from a PDF sent as form data, in a field named `file`. PDFs never enter the catalog. */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose a PDF file first, then try again." }, { status: 400 });
  }

  try {
    const ownerId = await getUserId();
    const map = await generatePdfSkillMap({ file: new Uint8Array(await file.arrayBuffer()), ownerId });
    writeFirstLessonSoon(map.id);
    return Response.json({ id: map.id }, { status: 201 });
  } catch (error) {
    if (error instanceof AiRefusedError) return Response.json({ error: error.message }, { status: 422 });
    return mapErrorResponse(error);
  }
}
