"use client";

import clsx from "clsx";
import { Check, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { buttonClasses, Spinner, TextInput } from "@/shared/ui";
import { interestNameProblem, MAX_INTERESTS, MIN_INTERESTS, SUGGESTED_INTERESTS, type Interest } from "../suggestions";

/**
 * First visit (and "Edit interests"): pick at least 3 interests from the suggestions, or type
 * your own. A typed one is checked on the server before it can be picked.
 */
export function InterestPicker({ initial, onDone, onCancel }: { initial: Interest[]; onDone: (interests: Interest[]) => void; onCancel?: () => void }) {
  const [options, setOptions] = useState<Interest[]>(() => [
    ...SUGGESTED_INTERESTS,
    ...initial.filter((interest) => !SUGGESTED_INTERESTS.some((suggestion) => suggestion.slug === interest.slug)),
  ]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial.map((interest) => interest.slug)));
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const full = picked.size >= MAX_INTERESTS;
  const ready = picked.size >= MIN_INTERESTS;

  function toggle(slug: string) {
    setSaveError(null);
    setPicked((before) => {
      const next = new Set(before);
      if (next.has(slug)) next.delete(slug);
      else if (next.size < MAX_INTERESTS) next.add(slug);
      return next;
    });
  }

  async function addTyped(event: FormEvent) {
    event.preventDefault();
    const problem = interestNameProblem(typed);
    if (problem) {
      setTypedError(problem);
      return;
    }
    setChecking(true);
    setTypedError(null);
    try {
      const response = await fetch("/api/feed/interests/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: typed }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.interest) throw new Error(data?.error ?? "We could not check that topic just now. Please try again.");
      const interest = data.interest as Interest;
      setOptions((before) => (before.some((option) => option.slug === interest.slug) ? before : [...before, interest]));
      setPicked((before) => (before.size < MAX_INTERESTS ? new Set(before).add(interest.slug) : before));
      setTyped("");
    } catch (caught) {
      setTypedError(caught instanceof Error ? caught.message : "We could not check that topic just now.");
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    if (!ready) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/feed/interests", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs: options.filter((option) => picked.has(option.slug)).map((option) => option.slug) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.interests) throw new Error(data?.error ?? "Your interests did not save. Please try again.");
      onDone(data.interests as Interest[]);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Your interests did not save. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[560px] px-4 pt-4 pb-6 lg:px-0 lg:pt-8">
          <h2 className="text-[2rem] leading-[1.05] font-bold font-stretch-[112%] text-balance sm:text-4xl">What are you curious about?</h2>
          <p className="mt-3 text-lg text-ink-soft">
            Pick {MIN_INTERESTS} or more. Your feed mixes them and leans towards the ones you like.
          </p>

          <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Interests">
            {options.map((option) => {
              const on = picked.has(option.slug);
              return (
                <button
                  key={option.slug}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && full}
                  onClick={() => toggle(option.slug)}
                  className={clsx(
                    "inline-flex min-h-11 cursor-pointer items-center gap-1.5 border-[1.5px] border-ink px-3.5 text-[0.9375rem] font-semibold transition-colors",
                    on ? "bg-ink text-on-dark" : "bg-sheet text-ink hover:bg-raised",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  {on && <Check aria-hidden="true" size={16} strokeWidth={3} />}
                  {option.name}
                </button>
              );
            })}
          </div>

          <form onSubmit={addTyped} className="mt-6" noValidate>
            <label htmlFor="own-interest" className="text-[0.9375rem] font-semibold">
              Add your own
            </label>
            <div className="mt-1.5 flex gap-2">
              <TextInput
                id="own-interest"
                value={typed}
                maxLength={60}
                placeholder="For example, Volcanoes"
                aria-invalid={typedError ? true : undefined}
                aria-describedby={typedError ? "own-interest-error" : undefined}
                readOnly={checking}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setTypedError(null);
                }}
              />
              <button type="submit" disabled={checking || full} className={clsx(buttonClasses("secondary", "md"), "shrink-0")}>
                {checking ? <Spinner /> : <Plus aria-hidden="true" size={18} />}
                Add
              </button>
            </div>
            {typedError && (
              <p id="own-interest-error" className="mt-2 text-[0.9375rem] font-semibold text-danger">
                {typedError}
              </p>
            )}
          </form>
        </div>
      </div>

      <div className="border-t-[1.5px] border-ink bg-sheet">
        <div className="mx-auto flex w-full max-w-[560px] items-center gap-3 px-4 py-3 lg:px-0">
          <p className="min-w-0 flex-1 text-[0.9375rem] text-ink-soft" aria-live="polite">
            {saveError ? (
              <span className="font-semibold text-danger">{saveError}</span>
            ) : ready ? (
              `${picked.size} picked`
            ) : (
              `Pick ${MIN_INTERESTS - picked.size} more`
            )}
          </p>
          {onCancel && (
            <button type="button" onClick={onCancel} className={buttonClasses("quiet", "md")}>
              Cancel
            </button>
          )}
          <button type="button" onClick={() => void save()} disabled={!ready || saving} className={buttonClasses("primary", "lg")}>
            {saving && <Spinner />}
            Start scrolling
          </button>
        </div>
      </div>
    </div>
  );
}
