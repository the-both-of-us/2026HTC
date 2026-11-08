"use client";

import { UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Button, buttonClasses, Card, ErrorNotice, Field, PageShell, Spinner, TextInput } from "@/shared/ui";
import { checkProfileInput, MAX_NAME_LENGTH } from "../rules";
import type { InviteView } from "../types";
import { acceptInvite, fetchInvite, type Result } from "./api";
import { loginHref } from "./view";

/** /people/invite/<code>: who invited you, and "Add as friend". */
export function InviteScreen({ code }: { code: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Result<{ invite: InviteView }> | null>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [friend, setFriend] = useState<string | null>(null);
  const nameId = useId();

  useEffect(() => {
    let current = true;
    fetchInvite(code).then((result) => {
      if (!current) return;
      setLoaded(result);
      if (result.ok) setName((previous) => previous || result.invite.displayName || "");
    });
    return () => {
      current = false;
    };
  }, [code, attempt]);

  async function accept(event: FormEvent<HTMLFormElement>, invite: InviteView) {
    event.preventDefault();
    if (saving) return;
    setFailure(null);
    if (!invite.hasProfile) {
      const checked = checkProfileInput({ displayName: name });
      if (!checked.ok) {
        setNameError(checked.errors.displayName);
        document.getElementById(nameId)?.focus();
        return;
      }
    }
    setSaving(true);
    const result = await acceptInvite(code, invite.hasProfile ? null : name);
    setSaving(false);
    if (result.ok) setFriend(result.friend);
    else setFailure(result.message);
  }

  const back = (
    <Link href="/people" className={buttonClasses("secondary", "sm")}>
      Go to People
    </Link>
  );

  return (
    <PageShell width="reading">
      <h1 className="text-3xl font-medium">Friend invite</h1>
      <div className="mt-6">
        {!loaded ? (
          <p role="status" className="flex items-center gap-3 text-lg text-ink-soft">
            <Spinner size={20} /> Loading the invite.
          </p>
        ) : !loaded.ok ? (
          <div className="flex flex-col gap-4">
            <ErrorNotice
              message={loaded.message}
              onRetry={loaded.status === 404 ? undefined : () => setAttempt((count) => count + 1)}
            />
            <div>{back}</div>
          </div>
        ) : (
          <Card className="border-rule sm:p-6">
            {friend ? (
              <div role="status" className="flex flex-col gap-4">
                <p className="text-xl font-medium">You and {friend} are now friends.</p>
                <p className="text-ink-soft">You each see the other&apos;s proven skills on People.</p>
                <div>
                  <Link href="/people" className={buttonClasses("primary", "sm")}>
                    See your friends
                  </Link>
                </div>
              </div>
            ) : loaded.invite.isYou ? (
              <div className="flex flex-col gap-4">
                <p className="text-lg">This is your own invite link. Send it to a friend, and they can add you here.</p>
                <div>{back}</div>
              </div>
            ) : loaded.invite.alreadyFriends ? (
              <div className="flex flex-col gap-4">
                <p className="text-lg">You and {loaded.invite.inviter.displayName} are already friends.</p>
                <div>{back}</div>
              </div>
            ) : (
              <form noValidate onSubmit={(event) => accept(event, loaded.invite)} className="flex flex-col gap-4">
                <div>
                  <p className="text-xl font-medium break-words">
                    {loaded.invite.inviter.displayName} invited you to be friends
                  </p>
                  {loaded.invite.inviter.city && (
                    <p className="mt-0.5 text-sm text-ink-soft">{loaded.invite.inviter.city}</p>
                  )}
                  <p className="mt-2 text-ink-soft">
                    Friends see each other&apos;s proven skills and evidence, even with the network off. You can remove
                    a friend at any time.
                  </p>
                </div>
                {loaded.invite.signInRequired ? (
                  <div>
                    <a href={loginHref(`/people/invite/${code}`)} className={buttonClasses("primary", "md")}>
                      Sign in to add {loaded.invite.inviter.displayName}
                    </a>
                  </div>
                ) : (
                  <>
                    {!loaded.invite.hasProfile && (
                      <Field
                        id={nameId}
                        label="Your name"
                        hint="Your friends see this name. It doesn't put you in the network."
                        error={nameError}
                      >
                        {(control) => (
                          <TextInput
                            {...control}
                            value={name}
                            onChange={(event) => {
                              setName(event.target.value);
                              setNameError(undefined);
                            }}
                            maxLength={MAX_NAME_LENGTH * 2}
                            autoComplete="name"
                            required
                          />
                        )}
                      </Field>
                    )}
                    {failure && <ErrorNotice message={failure} />}
                    <div>
                      <Button type="submit" pending={saving}>
                        <UserPlus aria-hidden="true" size={18} />
                        Add as friend
                      </Button>
                    </div>
                  </>
                )}
              </form>
            )}
          </Card>
        )}
      </div>
    </PageShell>
  );
}
