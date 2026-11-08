import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { getProgramPage, type ProgramPage } from "@/features/programs";
import { ProgramScreen, PublicProgramScreen } from "@/features/programs/client";
import { readUserId } from "@/shared/identity";
import { buttonClasses, ErrorNotice, PageShell, Spinner } from "@/shared/ui";

export const metadata: Metadata = { title: "Program" };

type ProgramPageProps = { params: Promise<{ id: string }> };

/** The id and cookie are only known at request time, so reading them waits behind Suspense. */
export default function ProgramPage({ params }: ProgramPageProps) {
  return (
    <Suspense fallback={<ProgramLoading />}>
      <ProgramFromRoute params={params} />
    </Suspense>
  );
}

async function ProgramFromRoute({ params }: ProgramPageProps) {
  // Reads live data, so mark the page as request-time first (see the map page).
  await connection();
  const { id } = await params;
  const loaded = await loadProgram(id);

  if (loaded === "failed") {
    return (
      <PageShell width="reading">
        <h1 className="text-3xl font-medium">Program</h1>
        <ErrorNotice className="mt-6" message="The program could not be loaded. Any progress is saved, so try again." />
        <Link href={`/program/${id}`} className={`${buttonClasses("secondary")} mt-4`}>
          Try again
        </Link>
      </PageShell>
    );
  }
  // A private program is the same answer as a missing one, so nobody can tell it exists.
  if (!loaded) {
    return (
      <Notice title="This program is not here">
        The link may be incomplete, or the program may be private or deleted. If it is yours, open it in the
        browser you planned it in. You can also plan a new one from a job posting or a topic.
      </Notice>
    );
  }
  if (loaded.mode === "public") return <PublicProgramScreen program={loaded.program} />;
  return <ProgramScreen program={loaded.program} sharing={loaded.sharing} />;
}

/** The program for this visitor: their own, a public one, or null when missing or private. */
async function loadProgram(id: string): Promise<ProgramPage | null | "failed"> {
  try {
    return await getProgramPage(id, await readUserId());
  } catch (error) {
    console.error("[program page] could not load a program", error);
    return "failed";
  }
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <PageShell width="reading">
      <h1 className="text-3xl font-medium">{title}</h1>
      <p className="mt-3 text-lg">{children}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/" className={buttonClasses("primary")}>
          Plan something new
        </Link>
        <Link href="/courses" className={buttonClasses("secondary")}>
          Browse public courses
        </Link>
      </div>
    </PageShell>
  );
}

function ProgramLoading() {
  return (
    <PageShell width="reading">
      <p role="status" className="flex items-center gap-2.5 text-ink-soft">
        <Spinner size={16} />
        Loading the program.
      </p>
    </PageShell>
  );
}
