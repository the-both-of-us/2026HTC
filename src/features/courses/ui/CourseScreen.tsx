"use client";

import clsx from "clsx";
import { ArrowLeft, ArrowRight, ChevronRight, Globe, Heart, ListChecks, Lock, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignInPrompt } from "@/features/auth/client";
import { type Ref, useEffect, useId, useRef, useState, useTransition } from "react";
import type { NodeState } from "@/shared/types";
import { Badge, Button, buttonClasses, ErrorNotice, PageShell, Spinner } from "@/shared/ui";
import { CourseCover } from "./CourseCard";
import type { CourseDetail, CourseSkill, LikeResult, PublicCourse } from "../types";
import { fetchCourse, setLike, startCourse } from "./api";
import {
  likesLabel,
  mapHref,
  optimisticLike,
  provenCount,
  SAMPLE_NOTE,
  SKILL_STATE_LABELS,
  skillHref,
  skillsLabel,
} from "./courseView";
import { DeleteCourse } from "./DeleteCourse";
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

/** Which control started the course: the main button, or one skill row (by its id). */
const MAIN_ACTION = "course";

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
  const { course, isOwner, published, skills, skillStates } = detail;
  // Set while private too, so the owner of a map built from a sample posting still sees the label.
  const isSample = course?.isSample ?? detail.isSample === true;
  // The map this viewer studies in: the course itself for its owner, or the copy they started.
  const openId = isOwner ? mapId : (detail.myCopyId ?? null);
  const starter = useStartCourse(mapId);
  const mainButtonId = useId();

  return (
    <PageShell width="wide">
      <Link href="/courses" className={`${buttonClasses("quiet", "sm")} -ml-0.5 self-start`}>
        <ArrowLeft aria-hidden="true" size={16} />
        All courses
      </Link>

      {/* The hero: the course's own seal behind its title, the same seal as its card in Courses. */}
      <CourseCover
        fingerprint={mapId}
        className="mt-4 flex flex-col gap-3 rounded-2xl px-6 py-8 sm:px-10 sm:py-12"
        sealClassName="-right-24 size-[28rem] max-sm:-right-40 max-sm:opacity-25"
      >
        {!published && (
          <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-on-ink/15 px-3 py-1 text-sm font-semibold">
            <Lock aria-hidden="true" size={14} />
            Private
          </span>
        )}
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="max-w-2xl text-[2.25rem] leading-[1.08] font-medium tracking-tight break-words outline-none sm:text-[3rem]"
        >
          {detail.title}
        </h1>
        {detail.subtitle && <p className="text-lg break-words text-on-ink-soft">{detail.subtitle}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-base text-on-ink-soft">
          {course && (
            <span className="inline-flex items-center gap-1.5">
              <UserRound aria-hidden="true" size={16} />
              by {course.authorName}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            {course && <span className="sr-only">, </span>}
            <ListChecks aria-hidden="true" size={16} />
            {skillsLabel(skills.length)}
          </span>
          {course && (
            <span className="inline-flex items-center gap-1.5">
              <span className="sr-only">, </span>
              <Heart aria-hidden="true" size={16} />
              {likesLabel(course.likeCount)}
            </span>
          )}
        </p>
      </CourseCover>

      {/*
        Two columns on a wide screen: the skills, and beside them a card that stays in view with
        the way in. On a phone the card comes first, so the main action is at the top.
      */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1">
          <section aria-label="Your progress" className="flex flex-col gap-5 rounded-xl border border-rule-strong bg-sheet p-5 shadow-sm">
            {skillStates && (
              <ProgressMeter
                proven={provenCount(skillStates, skills.map((skill) => skill.id))}
                total={skills.length}
                isOwner={isOwner}
              />
            )}
            {openId ? (
              <Link href={mapHref(openId)} className={clsx(buttonClasses("primary", "lg"), "w-full justify-center gap-2")}>
                {isOwner ? "Open your map" : "Continue this course"}
                <ArrowRight aria-hidden="true" size={18} />
              </Link>
            ) : (
              <Button
                id={mainButtonId}
                size="lg"
                className="w-full justify-center gap-2"
                pending={starter.pendingTarget === MAIN_ACTION}
                disabled={starter.pendingTarget !== null && starter.pendingTarget !== MAIN_ACTION}
                onClick={() => void starter.start(MAIN_ACTION)}
              >
                Start this course
                <ArrowRight aria-hidden="true" size={18} />
              </Button>
            )}
            {!openId && (
              <p className="-mt-2 text-sm text-ink-soft">Starting gives you your own copy of the map, so you can prove each skill yourself.</p>
            )}
            {starter.error && starter.target === MAIN_ACTION && (
              <ErrorNotice
                message={starter.error}
                onRetry={() => {
                  // Retrying removes this notice and its button, so keep focus on the start button.
                  document.getElementById(mainButtonId)?.focus();
                  void starter.start(MAIN_ACTION);
                }}
              />
            )}
            {published && course && !isOwner && (
              <div className="border-t border-rule pt-4">
                {detail.signInRequired ? (
                  <div className="flex flex-col items-start gap-1">
                    <p className="text-base">{likesLabel(course.likeCount)}</p>
                    <SignInPrompt action="like" />
                  </div>
                ) : (
                  <LikeToggle key={course.publishedAt} mapId={mapId} initial={{ liked: detail.likedByMe, likeCount: course.likeCount }} />
                )}
              </div>
            )}
          </section>

          {isOwner && (
            <section aria-labelledby="course-visibility" className="flex flex-col gap-3 rounded-xl border border-rule-strong bg-sheet p-5">
              <div className="flex min-w-0 items-start gap-3">
                <span aria-hidden="true" className="mt-0.5 text-ink-soft">
                  {published ? <Globe size={20} /> : <Lock size={20} />}
                </span>
                <div className="min-w-0">
                  <h2 id="course-visibility" className="font-semibold">
                    {published ? "Public course" : "Private course"}
                  </h2>
                  <p className="text-sm text-ink-soft">
                    {published && course
                      ? `Listed in Courses for anyone to start. ${likesLabel(course.likeCount)} from other learners.`
                      : "Only you can see it. Publish it to list it in Courses."}
                  </p>
                </div>
              </div>
              <PublishControls
                mapId={mapId}
                published={published}
                onChange={onPublishChange}
                showViewLink={false}
                showStatus={false}
                signInRequired={detail.signInRequired === true}
                displayName={detail.displayName ?? null}
              />
              <div className="border-t border-rule pt-2">
                <DeleteCourse mapId={mapId} published={published} />
              </div>
            </section>
          )}

          {isSample && <p className="px-1 text-sm text-ink-soft">{SAMPLE_NOTE}</p>}
        </aside>

        <section aria-labelledby="course-skills" className="min-w-0 lg:col-start-1 lg:row-start-1">
          <h2 id="course-skills" className="text-2xl font-medium">
            Skills, in learning order
          </h2>
          <p className="mt-1 text-ink-soft">
            Each skill builds on the ones before it.{" "}
            {openId ? "Choose one to read and study it." : "Choose one to start the course there."}
          </p>
          {starter.error && starter.target !== MAIN_ACTION && (
            <div className="mt-4">
              <ErrorNotice
                message={starter.error}
                onRetry={() => {
                  if (starter.target) void starter.start(starter.target);
                }}
              />
            </div>
          )}
          <ol className="mt-5 flex flex-col gap-3">
            {skills.map((skill, index) => (
              <li key={skill.id}>
                <SkillRow
                  skill={skill}
                  index={index}
                  state={skillStates?.[skill.id] ?? null}
                  href={openId ? skillHref(openId, skill.id) : null}
                  pending={starter.pendingTarget === skill.id}
                  disabled={starter.pendingTarget !== null}
                  onStart={() => void starter.start(skill.id)}
                />
              </li>
            ))}
          </ol>
        </section>
      </div>
    </PageShell>
  );
}

/** "3 of 10 skills proven", with a bar. The bar is decoration: the sentence says the same. */
function ProgressMeter({ proven, total, isOwner }: { proven: number; total: number; isOwner: boolean }) {
  const percent = total === 0 ? 0 : Math.round((proven / total) * 100);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="font-semibold">
          {total > 0 && proven === total ? "Every skill proven" : `${proven} of ${skillsLabel(total)} proven`}
        </p>
        <p className="text-sm text-ink-soft">{isOwner ? "On your map" : "On your copy"}</p>
      </div>
      <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full bg-proven transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/**
 * One skill as a card. With a map to open, it links straight to the skill there. Without one,
 * pressing it starts the course and then opens that skill in the new copy.
 */
function SkillRow({
  skill,
  index,
  state,
  href,
  pending,
  disabled,
  onStart,
}: {
  skill: CourseSkill;
  index: number;
  state: NodeState | null;
  href: string | null;
  pending: boolean;
  disabled: boolean;
  onStart: () => void;
}) {
  const className = clsx(
    "group flex w-full items-start gap-4 rounded-xl border border-rule-strong bg-sheet p-4 text-left shadow-sm transition duration-200 sm:p-5",
    "hover:border-control-edge hover:shadow-md motion-safe:hover:-translate-y-px disabled:cursor-wait disabled:hover:translate-y-0 disabled:hover:border-rule-strong disabled:hover:shadow-sm",
  );
  const content = (
    <>
      <span
        aria-hidden="true"
        className={clsx(
          "flex size-9 shrink-0 items-center justify-center rounded-full font-display text-base tabular-nums",
          state === "proven" ? "bg-proven text-on-proven" : "bg-raised text-ink",
        )}
      >
        {index + 1}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-lg leading-snug font-semibold break-words">
          <span className="sr-only">Skill {index + 1}: </span>
          {skill.title}
        </span>
        <span className="break-words text-ink-soft">{skill.why}</span>
        {(state || skill.fromSource) && (
          <span className="mt-1 flex flex-wrap gap-2">
            {state && <Badge tone={state}>{SKILL_STATE_LABELS[state]}</Badge>}
            {skill.fromSource && <Badge>Job asks</Badge>}
          </span>
        )}
      </span>
      <span aria-hidden="true" className="mt-1.5 shrink-0 text-ink-soft">
        {pending ? (
          <Spinner size={20} />
        ) : (
          <ChevronRight size={20} className="motion-safe:transition-transform group-hover:translate-x-0.5" />
        )}
      </span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className={className} disabled={disabled} aria-busy={pending} onClick={onStart}>
      {content}
    </button>
  );
}

/**
 * Starting a course: makes the learner's own copy, then opens it, at one skill if a row was
 * pressed. `pendingTarget` stays set until the new page loads, so the control stays busy.
 */
function useStartCourse(mapId: string) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [navigating, startNavigation] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Blocks a second press before React has re-rendered the controls as pending.
  const busy = useRef(false);

  async function start(nextTarget: string) {
    if (busy.current) return;
    busy.current = true;
    setTarget(nextTarget);
    setRequesting(true);
    setError(null);
    const result = await startCourse(mapId);
    busy.current = false;
    setRequesting(false);
    if (result.ok) {
      const href = nextTarget === MAIN_ACTION ? mapHref(result.mapId) : skillHref(result.mapId, nextTarget);
      startNavigation(() => router.push(href));
    } else {
      setError(result.message);
    }
  }

  return { start, target, error, pendingTarget: requesting || navigating ? target : null };
}

/** Like or unlike. The count changes at once, and goes back with a sentence if saving fails. */
function LikeToggle({ mapId, initial }: { mapId: string; initial: LikeResult }) {
  const [like, setLikeState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
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
        <Button id={buttonId} variant="secondary" aria-pressed={like.liked} onClick={toggle} className="gap-2">
          <Heart aria-hidden="true" size={18} className={like.liked ? "fill-current" : undefined} />
          Like
        </Button>
        <p aria-live="polite" className="text-base text-ink-soft">
          {likesLabel(like.likeCount)}
          {like.liked && ", including yours"}
        </p>
      </div>
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
