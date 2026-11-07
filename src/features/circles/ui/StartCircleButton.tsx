"use client";

import { Users, X } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { Button, buttonClasses, ErrorNotice, Field, TextInput } from "@/shared/ui";
import { circleUrl, startCircle } from "./api";
import { CircleQr } from "./CircleQr";

const MAX_NAME = 24;

/** For the map's owner: start a study circle, then show a QR code anyone in the room can scan. */
export function StartCircleButton({ mapId }: { mapId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Please type the name your circle will see.");
    setPending(true);
    setError(null);
    try {
      setCode((await startCircle(mapId, name)).code);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => dialogRef.current?.showModal()}>
        <Users aria-hidden="true" size={17} />
        Start a study circle
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="m-auto max-h-[94dvh] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-sheet border border-control-edge bg-sheet p-5 text-ink backdrop:bg-black/70 sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-2xl font-medium">
            {code ? "Scan to join the circle" : "Learn it together"}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => dialogRef.current?.close()}
            className="-m-1 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-control hover:bg-paper"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {code ? (
          <div className="mt-5 flex flex-col items-center gap-5">
            <CircleQr url={circleUrl(code)} size={300} />
            <p className="text-center text-ink-soft">
              Everyone who joins gets their own copy of this map. Prove a skill and the whole circle sees it.
            </p>
            <Link href={`/circle/${code}`} className={buttonClasses("primary", "lg")}>
              Open the circle page
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
            <p className="text-ink-soft">
              Friends, classmates or anyone curious join with a QR code and learn this map with you.
              They see who proved what, never what anyone wrote.
            </p>
            <Field id="circle-owner-name" label="Your name in the circle" hint={`Up to ${MAX_NAME} characters.`}>
              {(control) => (
                <TextInput
                  {...control}
                  value={name}
                  maxLength={MAX_NAME}
                  autoComplete="nickname"
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </Field>
            {error && <ErrorNotice message={error} />}
            <Button type="submit" pending={pending} className="self-start">
              Start the circle
            </Button>
          </form>
        )}
      </dialog>
    </>
  );
}
