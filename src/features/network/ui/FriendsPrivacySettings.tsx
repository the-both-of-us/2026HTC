"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClasses, Card, ErrorNotice, Spinner } from "@/shared/ui";
import type { PrivacySettings } from "../types";
import { fetchNetwork, savePrivacy } from "./api";

const OPTIONS: { name: keyof PrivacySettings; label: string; hint: string }[] = [
  {
    name: "shareProgress",
    label: "Friends see my courses and progress",
    hint: "Your friends see which courses you're studying and how many skills you've proved.",
  },
  {
    name: "allowRequests",
    label: "People in the network can send me friend requests",
    hint: "Off hides the Add friend button on your card. Invite links still work.",
  },
  { name: "allowPings", label: "Friends can ping me", hint: "A ping is a nudge to keep learning, at most once an hour." },
];

type State = { status: "loading" } | { status: "failed"; message: string } | { status: "none" } | { status: "ready"; settings: PrivacySettings };

/** The "Friends and privacy" section of /settings. Saves each switch as it changes. */
export function FriendsPrivacySettings() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState<keyof PrivacySettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    fetchNetwork().then((result) => {
      if (!current) return;
      if (!result.ok) setState({ status: "failed", message: result.message });
      else if (!result.view.me) setState({ status: "none" });
      else {
        const { shareProgress, allowRequests, allowPings } = result.view.me;
        setState({ status: "ready", settings: { shareProgress, allowRequests, allowPings } });
      }
    });
    return () => {
      current = false;
    };
  }, [attempt]);

  async function toggle(name: keyof PrivacySettings, value: boolean) {
    if (state.status !== "ready") return;
    const before = state.settings;
    // Shows the change at once, and puts it back if saving fails.
    setState({ status: "ready", settings: { ...before, [name]: value } });
    setSaving(name);
    setError(null);
    const result = await savePrivacy({ [name]: value });
    setSaving(null);
    if (!result.ok) {
      setState({ status: "ready", settings: before });
      return setError(result.message);
    }
    const { shareProgress, allowRequests, allowPings } = result.me;
    setState({ status: "ready", settings: { shareProgress, allowRequests, allowPings } });
  }

  if (state.status === "loading") {
    return (
      <Card>
        <p role="status" className="flex items-center gap-3 text-ink-soft">
          <Spinner size={18} />
          Loading your settings.
        </p>
      </Card>
    );
  }
  if (state.status === "failed") {
    return <ErrorNotice message={state.message} onRetry={() => setAttempt((count) => count + 1)} />;
  }
  if (state.status === "none") {
    return (
      <Card className="flex flex-col gap-3">
        <p className="text-ink-soft">
          You don&apos;t have a network profile yet. Make one to add friends, ping them and share your progress.
        </p>
        <Link href="/people" className={`${buttonClasses("secondary", "sm")} self-start`}>
          Make a profile
        </Link>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      {OPTIONS.map((option) => (
        <label key={option.name} className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-5 shrink-0 accent-[var(--color-proven)]"
            checked={state.settings[option.name]}
            disabled={saving !== null}
            aria-busy={saving === option.name || undefined}
            onChange={(event) => toggle(option.name, event.target.checked)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2 font-medium">
              {option.label}
              {saving === option.name && <Spinner size={14} />}
            </span>
            <span className="text-sm text-ink-soft">{option.hint}</span>
          </span>
        </label>
      ))}
      {error && <ErrorNotice message={error} />}
    </Card>
  );
}
