import clsx from "clsx";
import { ArrowRight, CircleCheck, Medal, Plus, RotateCcw } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { listCourses, type PublicCourse } from "@/features/courses";
import { CourseCard, CourseCover } from "@/features/courses/client";
import { getSession } from "@/shared/identity";
import { buttonClasses, ErrorNotice, PageShell, Spinner } from "@/shared/ui";
import { loadDashboard, type CourseRow, type DashboardData, type ProvenItem } from "../data";
import { cardsLabel, timeAgo, timeUntil } from "../format";
import { StreakCard } from "./StreakCard";

/** At most this many public courses under "Start with a course". */
const EXPLORE_COUNT = 3;

/** /dashboard. The cookie is only known at request time, so the content waits behind Suspense. */
export function DashboardScreen() {
  return (
    <PageShell width="wide">
      <Suspense fallback={<DashboardLoading />}>
        <DashboardContent />
      </Suspense>
    </PageShell>
  );
}

function DashboardLoading() {
  return (
    <>
      <h1 className="text-3xl font-medium">Dashboard</h1>
      <p role="status" className="mt-6 flex items-center gap-3 text-lg">
        <Spinner size={22} />
        Loading your dashboard.
      </p>
    </>
  );
}

/** Popular public courses this person has not started. A failure only hides the section. */
async function exploreCourses(mine: CourseRow[]): Promise<PublicCourse[]> {
  const started = new Set(mine.flatMap((course) => [course.mapId, course.startedFrom ?? ""]));
  try {
    const courses = await listCourses({ sort: "popular" });
    return courses.filter((course) => !started.has(course.mapId)).slice(0, EXPLORE_COUNT);
  } catch (error) {
    console.error("[dashboard] could not list courses to explore", error);
    return [];
  }
}

async function DashboardContent() {
  // The store reads live data and its client uses the clock, so mark this as request time first.
  await connection();
  const session = await getSession();
  const name = session.signedIn ? session.displayName : null;
  const now = new Date();

  // A first visit has no data yet: the same page, with zeros and courses to start.
  let data: DashboardData | null = null;
  if (session.userId) {
    try {
      data = await loadDashboard(session.userId, now);
    } catch (error) {
      console.error("[dashboard] could not load", error);
      return (
        <>
          <h1 className="text-3xl font-medium">Dashboard</h1>
          <ErrorNotice
            className="mt-6"
            message="Your dashboard could not be loaded this time. Please refresh the page to try again."
          />
        </>
      );
    }
  }

  const courses = [...(data?.courses ?? [])].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  const explore = await exploreCourses(courses);
  const latest = courses[0] ?? null;

  return (
    <>
      <Hero name={name} data={data} latest={latest} />

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <ProvenTile data={data} />
        <ReviewTile data={data} now={now} />
        <StreakCard activity={data?.activity ?? []} />
      </div>

      {courses.length > 0 && (
        <section aria-labelledby="courses-heading" className="mt-12">
          <SectionHeading id="courses-heading" action={<SectionLink href="/">New map</SectionLink>}>
            Your courses
          </SectionHeading>
          <ul className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {courses.map((course) => (
              <li key={course.mapId} className="min-w-0">
                <CourseCard
                  href={`/map/${course.mapId}`}
                  fingerprint={course.startedFrom ?? course.mapId}
                  title={course.title}
                  subtitle={`Last active ${timeAgo(course.lastActivityAt, now)}`}
                  skillCount={course.totalSkills}
                  progress={{ proven: course.provenCount, total: course.totalSkills }}
                  coverLabel={course.isCopy ? "Your copy" : course.isPublic ? "Public" : "Private"}
                  headingLevel="h3"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && data.recentProven.length > 0 && (
        <section aria-labelledby="proven-heading" className="mt-12">
          <SectionHeading id="proven-heading">Recently proven</SectionHeading>
          <ul className="mt-4 flex flex-col divide-y divide-rule overflow-hidden rounded-xl border border-rule-strong bg-sheet shadow-sm">
            {data.recentProven.map((item) => (
              <li key={`${item.mapId}/${item.nodeId}`}>
                <ProvenRow item={item} now={now} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {explore.length > 0 && (
        <section aria-labelledby="explore-heading" className="mt-12">
          <SectionHeading id="explore-heading" action={<SectionLink href="/courses">All courses</SectionLink>}>
            {courses.length > 0 ? "More to explore" : "Start with a course"}
          </SectionHeading>
          <ul className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {explore.map((course) => (
              <li key={course.mapId} className="min-w-0">
                <CourseCard
                  href={`/courses/${course.mapId}`}
                  fingerprint={course.mapId}
                  title={course.title}
                  subtitle={course.subtitle}
                  authorName={course.authorName}
                  skillCount={course.skillCount}
                  likeCount={course.likeCount}
                  headingLevel="h3"
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Buttons on the ink band: the colours turn around, so they read on it in either theme. */
const onInkPrimary =
  "inline-flex min-h-11 items-center gap-2 rounded-control bg-on-ink px-5 font-semibold text-ink transition-colors hover:bg-on-ink/90 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-on-ink";
const onInkSecondary =
  "inline-flex min-h-11 items-center gap-2 rounded-control px-5 font-semibold text-on-ink shadow-[inset_0_0_0_1.5px_var(--color-on-ink-soft)] transition-colors hover:bg-on-ink/10 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-on-ink";

/** A greeting, one line on where things stand, and the one thing to do next. */
function Hero({ name, data, latest }: { name: string | null; data: DashboardData | null; latest: CourseRow | null }) {
  const hasCourses = latest !== null;
  const due = data?.review ? data.review.dueCount + data.review.newCount : 0;
  const title = name ? `Welcome back, ${name}` : hasCourses ? "Welcome back" : "Welcome to OryxLearn";
  const line = hasCourses
    ? [
        `${data?.provenTotal ?? 0} ${data?.provenTotal === 1 ? "skill" : "skills"} proven`,
        due > 0 ? `${cardsLabel(due)} to review today` : null,
      ]
        .filter(Boolean)
        .join(" · ") + "."
    : "Learn anything, then prove you get it. Start a course below, or build a map from a topic, a job posting or a PDF.";

  return (
    <CourseCover
      fingerprint={latest?.startedFrom ?? latest?.mapId ?? "oryxlearn-dashboard"}
      className="flex flex-col gap-3 rounded-2xl px-6 py-8 sm:px-10 sm:py-10"
      sealClassName="-right-20 size-[24rem] max-sm:-right-40 max-sm:opacity-60"
    >
      <p className="text-sm font-semibold tracking-wide text-on-ink-soft uppercase">Dashboard</p>
      <h1 className="max-w-2xl text-3xl leading-tight font-medium tracking-tight break-words sm:text-[2.5rem]">{title}</h1>
      <p className="max-w-xl text-lg text-on-ink-soft">{line}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        {latest ? (
          <Link href={`/map/${latest.mapId}`} className={onInkPrimary}>
            <span className="max-w-[18rem] truncate">Continue {latest.title}</span>
            <ArrowRight aria-hidden="true" size={18} className="shrink-0" />
          </Link>
        ) : (
          <Link href="/courses" className={onInkPrimary}>
            Browse courses
            <ArrowRight aria-hidden="true" size={18} />
          </Link>
        )}
        <Link href="/" className={onInkSecondary}>
          <Plus aria-hidden="true" size={18} />
          Build a map
        </Link>
      </div>
    </CourseCover>
  );
}

function SectionHeading({ id, action, children }: { id: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <h2 id={id} className="text-2xl font-medium">
        {children}
      </h2>
      {action}
    </div>
  );
}

function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={clsx(buttonClasses("quiet", "sm"), "shrink-0 gap-1")}>
      {children}
      <ArrowRight aria-hidden="true" size={15} />
    </Link>
  );
}

/** A stat tile: an icon in a tinted circle, a big number, and one line. The streak tile matches it. */
function StatTile({
  labelledBy,
  icon,
  label,
  value,
  children,
}: {
  labelledBy: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={labelledBy} className="flex flex-col gap-2 rounded-xl border border-rule-strong bg-sheet p-5 shadow-sm">
      <h2 id={labelledBy} className="flex items-center gap-2.5 text-sm font-semibold text-ink-soft">
        <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-proven/12 text-proven">
          {icon}
        </span>
        {label}
      </h2>
      <p className="mt-1 text-4xl font-medium tabular-nums">{value}</p>
      {children}
    </section>
  );
}

function ProvenTile({ data }: { data: DashboardData | null }) {
  const total = data?.provenTotal ?? 0;
  const maps = data?.courses.filter((course) => course.provenCount > 0).length ?? 0;
  return (
    <StatTile labelledBy="proven-summary-heading" icon={<Medal size={16} />} label="Proven skills" value={total}>
      <p className="text-ink-soft">
        {total === 0 ? "Explain a skill in your own words to prove it." : `Across ${maps} of your ${maps === 1 ? "map" : "maps"}.`}
      </p>
    </StatTile>
  );
}

function ReviewTile({ data, now }: { data: DashboardData | null; now: Date }) {
  const review = data?.review;
  // With data but no review, review itself failed; with no data, there is nothing to review yet.
  if (data && !review) {
    return (
      <StatTile labelledBy="review-summary-heading" icon={<RotateCcw size={16} />} label="Review" value="–">
        <p className="text-ink-soft">Your review cards could not be loaded. Refresh the page to try again.</p>
      </StatTile>
    );
  }
  const dueToday = review ? review.dueCount + review.newCount : 0;
  return (
    <StatTile
      labelledBy="review-summary-heading"
      icon={<RotateCcw size={16} />}
      label="Review"
      value={
        <>
          {dueToday} <span className="text-lg font-normal text-ink-soft">due today</span>
        </>
      }
    >
      <p className="text-ink-soft">
        {!review || review.totalCards === 0
          ? "Make flashcards on a skill and they come back here on a schedule."
          : dueToday > 0
            ? `${cardsLabel(review.dueCount)} to review · ${review.newCount} new`
            : review.nextDueAt
              ? `All caught up. The next card is due ${timeUntil(review.nextDueAt, now)}.`
              : "All caught up."}
      </p>
      {dueToday > 0 && (
        <Link href="/review" className={clsx(buttonClasses("primary", "sm"), "mt-1 self-start")}>
          Review now
        </Link>
      )}
    </StatTile>
  );
}

function ProvenRow({ item, now }: { item: ProvenItem; now: Date }) {
  return (
    <Link
      href={`/map/${item.mapId}`}
      className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-raised"
    >
      <CircleCheck aria-hidden="true" size={20} className="shrink-0 text-proven" />
      <span className="min-w-0 flex-1 break-words">
        <span className="font-medium">{item.skillTitle}</span>
        <span className="text-ink-soft"> · {item.mapTitle}</span>
      </span>
      <time dateTime={item.provenAt} className="shrink-0 text-sm text-ink-soft">
        {timeAgo(item.provenAt, now)}
      </time>
    </Link>
  );
}
