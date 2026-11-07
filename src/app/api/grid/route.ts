import { connection } from "next/server";
import { getGridReading } from "@/features/grid";

/** The latest AESO reading. Always read at request time, never prerendered. */
export async function GET() {
  await connection();
  const reading = await getGridReading();
  const isLive = reading.status === "live";

  return Response.json(reading, {
    status: reading.status === "unavailable" ? 503 : 200,
    // The CDN can share a live reading for a short while. A failure is retried sooner.
    headers: { "cache-control": `public, max-age=0, s-maxage=${isLive ? 30 : 10}` },
  });
}
