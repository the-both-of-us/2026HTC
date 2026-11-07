import type { Metadata } from "next";
import { Suspense } from "react";
import { MapScreen, MapScreenLoading } from "@/features/skill-map/client";

export const metadata: Metadata = { title: "Skill map" };

type MapPageProps = { params: Promise<{ id: string }> };

/** The id is only known at request time, so reading it waits behind Suspense. */
export default function MapPage({ params }: MapPageProps) {
  return (
    <Suspense fallback={<MapScreenLoading />}>
      <MapFromRoute params={params} />
    </Suspense>
  );
}

async function MapFromRoute({ params }: MapPageProps) {
  const { id } = await params;
  return <MapScreen mapId={id} />;
}
