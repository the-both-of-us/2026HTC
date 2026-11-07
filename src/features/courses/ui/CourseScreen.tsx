"use client";

import { ArrowLeft, Heart, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type Ref, useEffect, useId, useRef, useState, useTransition } from "react";
import { Badge, Button, buttonClasses, Card, ErrorNotice, PageShell, Spinner } from "@/shared/ui";
import type { CourseDetail, LikeResult, PublicCourse } from "../types";
import { fetchCourse, setLike, startCourse } from "./api";
import { likesLabel, mapHref, optimisticLike, SAMPLE_NOTE, skillsLabel } from "./courseView";
import { PublishControls } from "./PublishCourseButton";

type LoadState =
  | { status: "loading" }
  | { status: "missing"; message: string }
  | { status: "failed"; message: string }
  | { status: "ready"; detail: CourseDetail };

/** One course at /courses/[id]: its skills in order, a like, and the way into the map. */
export function CourseScreen({ mapId }: { mapId: string }) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // After "Try again" the button is gone, so focus follows the content that replaced it:
  // the loading line while the course loads, then the page heading.
  const focusAfterRetry = useRef(false);
  const loadingLine = useRef<HTMLParagraphElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!focusAfterRetry.current) return;
    if (load.status === "loading") {
      loadingLine.current?.focus();
    } else {
      focusAfterRetry.current = false;
      heading.current?.focus();
    }
  }, [load.status]);

  useEffect(() => {
    let current = true;
    fetchCourse(mapId).then((result) => {
      if (!current) return;
      if (result.ok) setLoad({ status: "ready", detail: result.detail });
      else if (result.status === 404 || result.status === 400) setLoad({ status: "missing", message: result.message });
      else setLoad({ status: "failed", message: result.message });
    });
    return () => {
      current = false;
    };
  }, [mapId, attempt]);

  if (load.status === "loading") return <CourseScreenLoading lineRef={loadingLine} />;

  if (load.status === "missing") {
    return (
      <PageShell width="reading">
        <h1 ref={heading} tabIndex={-1} className="text-3xl font-medium outline-none">
          This course is not here
        </h1>
        <p className="mt-3 text-lg">
          The link may be incomplete, or its author may have made it private. There are other courses to
          explore.
        </p>
        <Link href="/courses" className={`${buttonClasses("primary")} mt-6 self-start`}>
          Browse courses
        </Link>
      </PageShell>
    );
  }

  if (load.status === "failed") {
    return (
      <PageShell width="reading">
        <h1 ref={heading} tabIndex={-1} className="mb-4 text-3xl font-medium outline-none">
          Course
        </h1>
        <ErrorNotice
          message={load.message}
          onRetry={() => {
            focusAfterRetry.current = true;
            setLoad({ status: "loading" });
            setAttempt((count) => count + 1);
          }}
        />
      </PageShell>
    );
  }

  return (
    <LoadedCourse
      mapId={mapId}
      detail={load.detail}
      headingRef={heading}
      onPublishChange={(course) =>
        setLoad({ status: "ready", detail: { ...load.detail, course, published: course !== null } })
      }
    />
  );
}

/** Shown while the course loads, and by the route while it resolves. */
export function CourseScreenLoading({ lineRef }: { lineRef?: Ref<HTMLParagraphElement> }) {
  return (
    <PageShell width="reading">
      <p ref={lineRef} tabIndex={-1} role="status" className="flex items-center gap-3 text-lg outline-none">
        <Spinner size={22} />
        Loading the course.
      </p>
    </PageShell>
  );
}

function LoadedCourse({
  mapId,
  detail,
  headingRef,
  onPublishChange,
}: {
  mapId: string;
  detail: CourseDetail;
  headingRef: Ref<HTMLHeadingElement>;
  onPublishChange: (course: PublicCourse | null) => void;
}) {
  const { course, isOwner, published, skills } = detail;
  // Set while private too, so the owner of a map built from a sample posting still sees the label.
  const isSample = course?.isSample ?? detail.isSample === true;

  return (
    <PageShell width="reading">
      <Link href="/courses" className={`${buttonClasses("quiet", "sm")} -ml-3 self-start`}>
        <ArrowLeft aria-hidden="true" size={16} />
        All courses
      </Link>

      <header className="mt-4 flex flex-col gap-2">
        {(isSample || !published) && (
          <div className="flex flex-wrap gap-2">
            {isSample && <Badge tone="sample">Sample</Badge>}
            {!published && (
              <Badge>
                <Lock aria-hidden="true" size={14} />
                Private
              </Badge>
            )}
          </div>
        )}
        <h1 ref={headingRef} tabIndex={-1} className="text-[2rem] leading-[1.12] font-medium break-words outline-none">
          {detail.title}
        </h1>
        {detail.subtitle && <p className="text-lg break-words text-ink-soft">{detail.subtitle}</p>}
        <p className="text-base">
          {course && <>by {course.authorName} · </>}
          {skillsLabel(skills.length)}
        </p>
      </header>

      {!published && isOwner && (
        <p className="mt-4 rounded-control border-2 border-dashed border-control-edge p-3 text-base">
          Private: only you can see this. Publish it below to list it in Courses.
        </p>
      )}
      {isSample && <p className="mt-3 text-sm text-ink-soft">{SAMPLE_NOTE}</p>}

      <div className="mt-6 flex flex-col gap-5">
        <StartCourseAction mapId={mapId} isOwner={isOwner} myCopyId={detail.myCopyId ?? null} />
        {published && course && (
          <LikeToggle
            key={course.publishedAt}
            mapId={mapId}
            initial={{ liked: detail.likedByMe, likeCount: course.likeCount }}
            isOwner={isOwner}
          />
        )}
      </div>

      {isOwner && (
        <Card className="mt-8">
          <h2 className="mb-1 text-xl font-medium">This is your course</h2>
          <p className="mb-4 text-ink-soft">
            {published
              ? "It is listed in Courses, so anyone can find it and like it."
              : "Only you can open it until you publish it."}
          </p>
          <PublishControls mapId={mapId} published={published} onChange={onPublishChange} showViewLink={false} />
        </Card>
      )}

      <section aria-labelledby="course-skills" className="mt-10">
        <h2 id="course-skills" className="text-2xl font-medium">
          Skills, in learning order
        </h2>
        <p className="mt-1 text-ink-soft">Each skill comes after the skills it builds on.</p>
        <ol className="mt-4 flex flex-col">
          {skills.map((skill, index) => (
            <li key={skill.id} className="flex gap-4 border-t border-rule py-4">
              <span aria-hidden="true" className="w-7 shrink-0 pt-0.5 font-display text-lg text-ink-soft">
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="text-lg font-semibold break-words">{skill.title}</h3>
                  {skill.fromSource && <Badge>Job asks</Badge>}
                </div>
                <p className="break-words text-ink-soft">{skill.why}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </PageShell>
  );
}

/**
 * The course's main action. The owner opens their own map, a learner who started the course
 * continues their copy, and anyone else starts one.
 */
function StartCourseAction({ mapId, isOwner, myCopyId }: { mapId: string; isOwner: boolean; myCopyId: string | null }) {
  const openId = isOwner ? mapId : myCopyId;
  if (openId) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Link href={mapHref(openId)} className={buttonClasses("primary", "lg")}>
          {isOwner ? "Open your map" : "Continue this course"}
        </Link>
      </div>
    );
  }
  return <StartCourseButton mapId={mapId} />;
}

/** Makes the learner's own copy, then opens it. A failure shows a sentence and a retry. */
function StartCourseButton({ mapId }: { mapId: string }) {
  const router = useRouter();
  const [requesting, setRequesting] = useState(false);
  // True while the router loads the new map, so the button stays busy until the page changes.
  const [navigating, startNavigation] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Blocks a second click before React has re-rendered the button as pending.
  const busy = useRef(false);
  const buttonId = useId();
  const noteId = useId();

  async function start() {
    if (busy.current) return;
    busy.current = true;
    setRequesting(true);
    setError(null);
    const result = await startCourse(mapId);
    busy.current = false;
    setRequesting(false);
    if (result.ok) {
      startNavigation(() => router.push(mapHref(result.mapId)));
    } else {
      setError(result.message);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        id={buttonId}
        size="lg"
        pending={requesting || navigating}
        aria-describedby={noteId}
        onClick={() => void start()}
      >
        Start this course
      </Button>
      <p id={noteId} className="text-sm text-ink-soft">
        You get your own copy of the map, so you can prove each skill yourself.
      </p>
      {error && (
        <ErrorNotice
          message={error}
          onRetry={() => {
            // Retrying removes this notice and its button, so keep focus on the start button.
            document.getElementById(buttonId)?.focus();
            void start();
          }}
        />
      )}
    </div>
  );
}

/** Like or unlike. The count changes at once, and goes back with a sentence if saving fails. */
function LikeToggle({ mapId, initial, isOwner }: { mapId: string; initial: LikeResult; isOwner: boolean }) {
  const [like, setLikeState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const noteId = useId();
  const buttonId = useId();

  async function toggle() {
    if (saving.current) return;
    saving.current = true;
    const before = like;
    const next = optimisticLike(like, !like.liked);
    setLikeState(next);
    setError(null);
    const result = await setLike(mapId, next.liked);
    saving.current = false;
    if (result.ok) {
      setLikeState({ liked: result.liked, likeCount: result.likeCount });
    } else {
      setLikeState(before);
      setError(result.message);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          id={buttonId}
          variant="subtle"
          aria-pressed={like.liked}
          disabled={isOwner}
          aria-describedby={isOwner ? noteId : undefined}
          onClick={toggle}
        >
          <Heart aria-hidden="true" size={18} className={like.liked ? "fill-current" : undefined} />
          Like this course
        </Button>
        <p aria-live="polite" className="text-base">
          {likesLabel(like.likeCount)}
          {like.liked && ", including yours"}
        </p>
      </div>
      {isOwner && (
        <p id={noteId} className="text-sm text-ink-soft">
          You can&apos;t like your own course. Likes come from other learners.
        </p>
      )}
      {error && (
        <ErrorNotice
          message={error}
          onRetry={() => {
            // Retrying removes this notice and its button, so keep focus on the like button.
            document.getElementById(buttonId)?.focus();
            void toggle();
          }}
        />
      )}
    </div>
  );
}
