"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, TextInput } from "@/shared/ui";

/** The passcode form. The passcode is checked on the server; the browser only ever gets an httpOnly cookie. */
export function AdminLogin() {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (response.ok) {
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "That didn't work. Try again.");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-4">
      <h1 className="text-3xl font-medium">Admin</h1>
      <Field id="admin-passcode" label="Passcode" error={error}>
        {(control) => (
          <TextInput
            {...control}
            type="password"
            autoComplete="current-password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            required
          />
        )}
      </Field>
      <Button type="submit" disabled={busy || !passcode} className="self-start">
        {busy ? "Checking…" : "Open admin"}
      </Button>
    </form>
  );
}
