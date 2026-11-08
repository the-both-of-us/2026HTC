"use client";

import { useEffect, useId, useState } from "react";
import { Card, ErrorNotice, Spinner } from "@/shared/ui";
import {
  AI_TASKS,
  DEFAULT_AI_SETTINGS,
  MODEL_CHOICES,
  MODEL_LABELS,
  SPEED_LABELS,
  SPEEDS,
  TASK_LABELS,
  type AiSettings,
  type ModelChoice,
  type Speed,
} from "../types";

type Status = "loading" | "ready" | "saving" | "saved" | "error";

const LOAD_FAILED = "Your AI settings could not be loaded. The defaults are in use. Reload the page to try again.";
const SAVE_FAILED = "That change could not be saved. Please try again.";

/**
 * Speed (Auto, Fast, Thorough) and, under Advanced, a model per task. Saved on the server for
 * this visitor as soon as it changes, because the routes that call a model read it from there.
 */
export function AiSettingsForm() {
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const speedName = useId();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { signal: AbortSignal.timeout(10_000) })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("load failed"))))
      .then((body: { settings?: AiSettings }) => {
        if (cancelled) return;
        if (body.settings) setSettings(body.settings);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setError(LOAD_FAILED);
        setStatus("ready");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: AiSettings) {
    const previous = settings;
    setSettings(next);
    setStatus("saving");
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.settings) throw new Error(typeof body?.error === "string" ? body.error : SAVE_FAILED);
      setSettings(body.settings);
      setStatus("saved");
    } catch (caught) {
      setSettings(previous);
      setError(caught instanceof Error && caught.message !== "" ? caught.message : SAVE_FAILED);
      setStatus("error");
    }
  }

  const disabled = status === "loading" || status === "saving";
  const overrideCount = Object.values(settings.overrides).filter((choice) => choice && choice !== "auto").length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-soft">
        Everyday topics use gpt-oss-120b, which answers in about a second. Hard courses, and ones
        where a wrong fact matters (health, electrical safety, law, money), step up to Claude
        models, which write more carefully and take longer. Lessons, flashcards and quizzes are
        written once per skill and saved, so you only wait the first time.
      </p>

      <Card>
        <fieldset disabled={disabled} className="flex flex-col gap-3">
          <legend className="mb-2 font-medium text-ink">Speed</legend>
          {SPEEDS.map((speed: Speed) => (
            <label key={speed} className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name={speedName}
                value={speed}
                checked={settings.speed === speed}
                onChange={() => save({ ...settings, speed })}
                className="mt-1 size-4 shrink-0 cursor-pointer accent-accent"
              />
              <span className="flex flex-col">
                <span className="font-medium text-ink">{SPEED_LABELS[speed].label}</span>
                <span className="text-sm text-ink-soft">{SPEED_LABELS[speed].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Card>

      <details className="group rounded-sheet border border-rule-strong bg-sheet">
        <summary className="flex min-h-12 cursor-pointer items-center px-5 font-medium text-ink sm:px-6">
          Advanced: a model for each task
          {overrideCount > 0 && <span className="ml-2 text-sm font-normal text-ink-soft">({overrideCount} set)</span>}
        </summary>
        <div className="flex flex-col gap-4 border-t border-rule px-5 py-5 sm:px-6">
          <p className="text-sm text-ink-soft">
            Auto follows the speed above. A model picked here is used for that task on every course,
            whatever the speed.
          </p>
          {AI_TASKS.map((task) => (
            <TaskSelect
              key={task}
              label={TASK_LABELS[task].label}
              hint={TASK_LABELS[task].hint}
              value={settings.overrides[task] ?? "auto"}
              disabled={disabled}
              onChange={(choice) => save({ ...settings, overrides: { ...settings.overrides, [task]: choice } })}
            />
          ))}
        </div>
      </details>

      <p className="text-sm text-ink-soft">
        Saved for you on OryxLearn, so every page uses it. If a Claude model is busy or unavailable,
        the fast model answers instead.
      </p>
      <p aria-live="polite" className="flex min-h-6 items-center gap-2 text-sm text-ink-soft">
        {status === "loading" && (
          <>
            <Spinner size={16} /> Loading your settings
          </>
        )}
        {status === "saving" && (
          <>
            <Spinner size={16} /> Saving
          </>
        )}
        {status === "saved" && "Saved."}
      </p>
      {error && <ErrorNotice message={error} />}
    </div>
  );
}

function TaskSelect({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: ModelChoice;
  disabled: boolean;
  onChange: (choice: ModelChoice) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex flex-col">
        <label htmlFor={id} className="font-medium text-ink">
          {label}
        </label>
        <span id={`${id}-hint`} className="text-sm text-ink-soft">
          {hint}
        </span>
      </div>
      <select
        id={id}
        aria-describedby={`${id}-hint`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as ModelChoice)}
        className="min-h-11 w-full shrink-0 cursor-pointer rounded-control border border-control-edge bg-sheet px-2 text-sm font-medium text-ink sm:w-60"
      >
        {MODEL_CHOICES.map((choice) => (
          <option key={choice} value={choice}>
            {MODEL_LABELS[choice]}
          </option>
        ))}
      </select>
    </div>
  );
}
