import { connection } from "next/server";
import { getLabourSnapshot } from "../service";
import { LabourCard } from "./LabourCard";

/** Fetches per request, so the figures are never built into the page. Wrap in <Suspense> where used. */
export async function LiveLabourCard() {
  await connection();
  return <LabourCard snapshot={await getLabourSnapshot()} />;
}
