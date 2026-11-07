"use client";

import { usePathname } from "next/navigation";
import { loginHref } from "./links";

export type SignInPromptProps = {
  action: "like" | "publish";
};

const SENTENCES: Record<SignInPromptProps["action"], { lead: string; rest: string }> = {
  like: { lead: "Sign in", rest: " to like courses." },
  publish: { lead: "Sign in", rest: " to publish, so your name shows on it." },
};

/** One sentence in place of a control a guest can't use, with the sign-in link inside it. */
export function SignInPrompt({ action }: SignInPromptProps) {
  const pathname = usePathname();
  const { lead, rest } = SENTENCES[action];
  return (
    <p className="text-base">
      <a href={loginHref(pathname)} className="font-semibold text-accent-bright underline underline-offset-4 hover:text-ink">
        {lead}
      </a>
      {rest}
    </p>
  );
}
