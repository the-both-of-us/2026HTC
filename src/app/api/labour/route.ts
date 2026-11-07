import { getLabourSnapshot } from "@/features/labour";

export async function GET() {
  const snapshot = await getLabourSnapshot();
  if (!snapshot) {
    return Response.json({ error: "Statistics Canada data is unavailable right now." }, { status: 503 });
  }
  return Response.json(snapshot);
}
