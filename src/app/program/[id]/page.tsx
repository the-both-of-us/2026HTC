import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { getProgramView, type ProgramView } from "@/features/programs";
import { ProgramScreen } from "@/features/programs/client";
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
  // Someone else's program is the same answer as a missing one, so nobody can tell it exists.
  if (!loaded) {
    return (
      <Notice title="This program is not here">
        The link may be incomplete, or the program may be someone else&apos;s or deleted. Programs are private: if it
        is yours, open it in the browser you planned it in. You can also plan a new one from a topic.
      </Notice>
    );
  }
  return <ProgramScreen program={loaded} />;
}

/** The visitor's own program, or null when it is missing or someone else's. */
async function loadProgram(id: string): Promise<ProgramView | null | "failed"> {
  try {
    return await getProgramView(id, await readUserId());
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
          Browse shared courses
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
