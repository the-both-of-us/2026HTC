import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { canReadMap } from "@/app/api/maps/[id]/access";
import { getSkillMap } from "@/features/skill-map";
import { MapScreen, MapScreenLoading } from "@/features/skill-map/client";
import { readUserId } from "@/shared/identity";
import { buttonClasses, PageShell } from "@/shared/ui";

export const metadata: Metadata = { title: "Skill map" };

type MapPageProps = { params: Promise<{ id: string }> };

/** The id and cookie are only known at request time, so reading them waits behind Suspense. */
export default function MapPage({ params }: MapPageProps) {
  return (
    <Suspense fallback={<MapScreenLoading />}>
      <MapFromRoute params={params} />
    </Suspense>
  );
}

async function MapFromRoute({ params }: MapPageProps) {
  const { id } = await params;
  if (await isPrivateToSomeoneElse(id)) return <PrivateMapNotice />;
  return <MapScreen mapId={id} />;
}

/**
 * MapScreen shows its own messages for a missing map or a failed load, and its API
 * call applies the same check. So if the store fails here, let it handle that.
 */
async function isPrivateToSomeoneElse(id: string): Promise<boolean> {
  try {
    const map = await getSkillMap(id);
    return map !== null && !(await canReadMap(map, await readUserId()));
  } catch (error) {
    console.error("[map page] could not check who may read a map", error);
    return false;
  }
}

function PrivateMapNotice() {
  return (
    <PageShell width="reading">
      <h1 className="text-3xl font-medium">This map is private</h1>
      <p className="mt-3 text-lg">
        Only the person who built it can open it. If it is yours, open it in the browser you built
        it in. You can also build your own from a job posting, or start a public course.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/" className={buttonClasses("primary")}>
          Build a new map
        </Link>
        <Link href="/courses" className={buttonClasses("secondary")}>
          Browse public courses
        </Link>
      </div>
    </PageShell>
  );
}
