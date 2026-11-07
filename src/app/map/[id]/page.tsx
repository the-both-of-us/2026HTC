import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { canReadMap } from "@/app/api/maps/[id]/access";
import { findCircleForMap } from "@/features/circles";
import { CircleBanner, StartCircleButton } from "@/features/circles/client";
import { getSkillMap } from "@/features/skill-map";
import { MapScreen, MapScreenLoading } from "@/features/skill-map/client";
import { isVoiceReady } from "@/features/voice";
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
  // The privacy check reads live data, and the storage client's use of the clock is an
  // error under Cache Components unless the page is marked as request-time first.
  await connection();
  const { id } = await params;
  // Voice controls only appear once the server knows its voice key works.
  const [isPrivate, voiceReady, circle] = await Promise.all([isPrivateToSomeoneElse(id), isVoiceReady(), circleOf(id)]);
  if (isPrivate) return <PrivateMapNotice />;
  return (
    <MapScreen
      mapId={id}
      voiceReady={voiceReady}
      banner={circle && <CircleBanner code={circle.code} title={circle.title} />}
      ownerActions={<StartCircleButton mapId={id} />}
    />
  );
}

/** The study circle this map belongs to, for the banner. A failure only hides the banner. */
async function circleOf(id: string): Promise<{ code: string; title: string } | null> {
  try {
    const userId = await readUserId();
    return userId ? await findCircleForMap(id, userId) : null;
  } catch (error) {
    console.error("[map page] could not check for a study circle", error);
    return null;
  }
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
