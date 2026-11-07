"use client";

import { Globe } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { SignInPrompt } from "@/features/auth/client";
import { Badge, Button, buttonClasses, Field } from "@/shared/ui";
import { MAX_AUTHOR_NAME_LENGTH } from "../rules";
import type { PublicCourse } from "../types";
import { fetchCourse, publishCourse, unpublishCourse } from "./api";
import { courseHref } from "./courseView";

export type PublishCourseButtonProps = {
  mapId: string;
};

/**
 * Publish or unpublish a map, for the map header. It shows nothing until it knows the
 * viewer owns the map, and nothing at all to anyone else, or if the check fails.
 */
export function PublishCourseButton({ mapId }: PublishCourseButtonProps) {
  const [published, setPublished] = useState<boolean | null>(null);
  const [viewer, setViewer] = useState<{ signInRequired: boolean; displayName: string | null }>({
    signInRequired: false,
    displayName: null,
  });

  useEffect(() => {
    let current = true;
    fetchCourse(mapId).then((result) => {
      if (!current || !result.ok || !result.detail.isOwner) return;
      setViewer({
        signInRequired: result.detail.signInRequired === true,
        displayName: result.detail.displayName ?? null,
      });
      setPublished(result.detail.published);
    });
    return () => {
      current = false;
    };
  }, [mapId]);

  if (published === null) return null;
  return (
    <PublishControls
      mapId={mapId}
      published={published}
      onChange={(next) => setPublished(next !== null)}
      signInRequired={viewer.signInRequired}
      displayName={viewer.displayName}
    />
  );
}

type PublishControlsProps = {
  mapId: string;
  published: boolean;
  /** Called with the new listing after publishing, or null after making the course private. */
  onChange: (course: PublicCourse | null) => void;
  /** The course page hides this, since the viewer is already there. */
  showViewLink?: boolean;
  /** A guest while sign-in is set up: show a sign-in sentence instead of the publish form. */
  signInRequired?: boolean;
  /** The signed-in viewer's name, to pre-fill "Name to show". */
  displayName?: string | null;
};

type FocusTarget = "field" | "publish" | "makePrivate" | null;

const INPUT_CLASSES =
  "block min-h-10 w-full rounded-control border-2 border-control-edge bg-sheet px-3 py-1.5 text-base text-ink placeholder:text-ink-soft aria-invalid:border-danger";

/** The publish toggle itself, shared by the map header and the course page. */
export function PublishControls({
  mapId,
  published,
  onChange,
  showViewLink = true,
  signInRequired = false,
  displayName = null,
}: PublishControlsProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState(() => (displayName ?? "").slice(0, MAX_AUTHOR_NAME_LENGTH));
  const [pending, setPending] = useState<"publish" | "unpublish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const area = useRef<HTMLDivElement>(null);
  const focusNext = useRef<FocusTarget>(null);
  const fieldId = useId();

  // Move focus only after something the person did, once the new control is on screen.
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target) area.current?.querySelector<HTMLElement>(`[data-focus="${target}"]`)?.focus();
  }, [formOpen, published]);

  function openForm() {
    setError(null);
    setAnnouncement("");
    focusNext.current = "field";
    setFormOpen(true);
  }

  function cancel() {
    setError(null);
    focusNext.current = "publish";
    setFormOpen(false);
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending("publish");
    setError(null);
    const result = await publishCourse(mapId, name);
    setPending(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    focusNext.current = "makePrivate";
    setFormOpen(false);
    setAnnouncement(`Published as ${result.course.authorName}. Your course is now listed in Courses.`);
    onChange(result.course);
  }

  async function unpublish() {
    if (pending) return;
    setPending("unpublish");
    setError(null);
    const result = await unpublishCourse(mapId);
    setPending(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    focusNext.current = "publish";
    setAnnouncement("Made private. Only you can see this course now.");
    onChange(null);
  }

  return (
    <div ref={area} className="flex max-w-full flex-col gap-2">
      {published ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge>
            <Globe aria-hidden="true" size={14} />
            Public
          </Badge>
          <Button
            variant="subtle"
            size="sm"
            data-focus="makePrivate"
            pending={pending === "unpublish"}
            onClick={unpublish}
          >
            Make private
          </Button>
          {showViewLink && (
            <Link href={courseHref(mapId)} className={buttonClasses("quiet", "sm")}>
              View in Courses
            </Link>
          )}
        </div>
      ) : formOpen ? (
        <form onSubmit={publish} className="flex flex-wrap items-end gap-2">
          <Field
            id={fieldId}
            label="Name to show"
            hint="Leave empty to show Anonymous learner"
            className="min-w-0 flex-1 basis-56"
          >
            {(control) => (
              <input
                {...control}
                data-focus="field"
                type="text"
                autoComplete="nickname"
                maxLength={MAX_AUTHOR_NAME_LENGTH}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={INPUT_CLASSES}
              />
            )}
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" pending={pending === "publish"}>
              Publish
            </Button>
            <Button variant="quiet" size="sm" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      ) : signInRequired ? (
        // Publishing puts a name on the course, so it needs a sign-in. Making it private never does.
        <SignInPrompt action="publish" />
      ) : (
        <Button variant="subtle" size="sm" data-focus="publish" onClick={openForm} className="self-start">
          Publish course
        </Button>
      )}

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
