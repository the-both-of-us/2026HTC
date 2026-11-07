import { BookOpen, Globe, Lock, Medal, RotateCcw } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { getSession } from "@/shared/identity";
import { Badge, buttonClasses, Card, ErrorNotice, PageShell, Spinner } from "@/shared/ui";
import { loadDashboard, type CourseRow, type DashboardData, type ProvenItem } from "../data";
import { cardsLabel, provenLabel, timeAgo, timeUntil } from "../format";
import { StreakCard } from "./StreakCard";

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

async function DashboardContent() {
  // The store reads live data and its client uses the clock, so mark this as request time first.
  await connection();
  const session = await getSession();
  const greeting = session.signedIn && session.displayName ? `Welcome back, ${session.displayName}.` : null;
  if (!session.userId) return <Welcome greeting={greeting} />;

  const now = new Date();
  let data: DashboardData;
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
  if (data.courses.length === 0) return <Welcome greeting={greeting} />;

  return (
    <>
      <h1 className="text-3xl font-medium">Dashboard</h1>
      <p className="mt-2 text-lg text-ink-soft">{greeting ?? "Your maps, what you have proven, and what is due."}</p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <ProvenSummary data={data} />
        <ReviewSummaryCard data={data} now={now} />
        <StreakCard activity={data.activity} />
      </div>

      <section aria-labelledby="courses-heading" className="mt-10">
        <h2 id="courses-heading" className="text-2xl font-medium">
          Your courses
        </h2>
        <ul className="mt-4 grid gap-4 lg:grid-cols-2">
          {data.courses.map((course) => (
            <li key={course.mapId} className="min-w-0">
              <CourseItem course={course} now={now} />
            </li>
          ))}
        </ul>
      </section>

      {data.recentProven.length > 0 && (
        <section aria-labelledby="proven-heading" className="mt-10">
          <h2 id="proven-heading" className="text-2xl font-medium">
            Recently proven
          </h2>
          <ul className="mt-4 flex flex-col divide-y divide-rule rounded-sheet border border-rule-strong bg-sheet/90">
            {data.recentProven.map((item) => (
              <li key={`${item.mapId}/${item.nodeId}`}>
                <ProvenRow item={item} now={now} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Welcome({ greeting }: { greeting: string | null }) {
  return (
    <>
      <h1 className="text-3xl font-medium">Welcome to OryxLearn</h1>
      <Card className="mt-6 flex flex-col items-start gap-4">
        <p className="text-lg">
          {greeting ? `${greeting} ` : ""}This is where your maps, the skills you have proven, your review cards and
          your streak will show up.
        </p>
        <p className="text-ink-soft">
          Start by turning a job posting, a PDF or a topic into a skill map, or pick a course someone has shared.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/" className={buttonClasses("primary")}>
            Build a map
          </Link>
          <Link href="/courses" className={buttonClasses("secondary")}>
            Browse courses
          </Link>
        </div>
      </Card>
    </>
  );
}

function SummaryCard({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="flex flex-col gap-3 rounded-sheet border border-rule-strong bg-sheet/90 p-5 shadow-panel"
    >
      {children}
    </section>
  );
}

function ProvenSummary({ data }: { data: DashboardData }) {
  return (
    <SummaryCard labelledBy="proven-summary-heading">
      <h2 id="proven-summary-heading" className="flex items-center gap-2 text-base font-semibold text-ink-soft">
        <Medal aria-hidden="true" size={18} />
        Proven skills
      </h2>
      <p className="text-3xl font-medium">{data.provenTotal}</p>
      <p className="text-ink-soft">
        {data.provenTotal === 0
          ? "Explain a skill in your own words to prove it."
          : `Across ${data.courses.filter((course) => course.provenCount > 0).length} of your maps.`}
      </p>
    </SummaryCard>
  );
}

function ReviewSummaryCard({ data, now }: { data: DashboardData; now: Date }) {
  const review = data.review;
  const dueToday = review ? review.dueCount + review.newCount : 0;
  return (
    <SummaryCard labelledBy="review-summary-heading">
      <h2 id="review-summary-heading" className="flex items-center gap-2 text-base font-semibold text-ink-soft">
        <RotateCcw aria-hidden="true" size={18} />
        Review
      </h2>
      {!review ? (
        <p>Your review cards could not be loaded. Refresh the page to try again.</p>
      ) : review.totalCards === 0 ? (
        <>
          <p className="text-3xl font-medium">0</p>
          <p className="text-ink-soft">Make flashcards on a skill and they come back here on a schedule.</p>
        </>
      ) : (
        <>
          <p className="text-3xl font-medium">
            {dueToday} <span className="text-lg font-normal text-ink-soft">due today</span>
          </p>
          <p className="text-ink-soft">
            {dueToday > 0
              ? `${cardsLabel(review.dueCount)} to review · ${review.newCount} new`
              : review.nextDueAt
                ? `All caught up. The next card is due ${timeUntil(review.nextDueAt, now)}.`
                : "All caught up."}
          </p>
          {dueToday > 0 && (
            <Link href="/review" className={`${buttonClasses("primary")} self-start`}>
              Review now
            </Link>
          )}
        </>
      )}
    </SummaryCard>
  );
}

function CourseItem({ course, now }: { course: CourseRow; now: Date }) {
  const percent = course.totalSkills === 0 ? 0 : Math.round((course.provenCount / course.totalSkills) * 100);
  return (
    <article className="flex h-full flex-col gap-3 rounded-sheet border border-control-edge bg-sheet p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-xl leading-snug font-medium break-words">{course.title}</h3>
        <Badge className="shrink-0">
          {course.isPublic ? <Globe aria-hidden="true" size={14} /> : <Lock aria-hidden="true" size={14} />}
          {course.isPublic ? "Public" : "Private"}
        </Badge>
      </div>
      {course.subtitle && <p className="break-words text-ink-soft">{course.subtitle}</p>}
      {course.isCopy && (
        <p className="flex items-center gap-1.5 text-sm text-ink-soft">
          <BookOpen aria-hidden="true" size={15} />
          Your copy of a shared course
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-semibold">{provenLabel(course.provenCount, course.totalSkills)}</p>
        <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-proven" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <p className="text-sm text-ink-soft">
        Last active <time dateTime={course.lastActivityAt}>{timeAgo(course.lastActivityAt, now)}</time>
      </p>
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Link href={`/map/${course.mapId}`} className={buttonClasses("secondary", "sm")}>
          Open map<span className="sr-only">: {course.title}</span>
        </Link>
        {course.isPublic && (
          <Link href={`/courses/${course.mapId}`} className={buttonClasses("quiet", "sm")}>
            Course page<span className="sr-only">: {course.title}</span>
          </Link>
        )}
      </div>
    </article>
  );
}

function ProvenRow({ item, now }: { item: ProvenItem; now: Date }) {
  return (
    <Link
      href={`/map/${item.mapId}`}
      className="flex flex-col gap-0.5 px-5 py-3 transition-control hover:bg-raised sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
    >
      <span className="min-w-0 break-words">
        <span className="font-medium">{item.skillTitle}</span>
        <span className="text-ink-soft"> · {item.mapTitle}</span>
      </span>
      <time dateTime={item.provenAt} className="shrink-0 text-sm text-ink-soft">
        Proven {timeAgo(item.provenAt, now)}
      </time>
    </Link>
  );
}
