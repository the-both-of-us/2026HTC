import { Users } from "lucide-react";
import Link from "next/link";
import { buttonClasses } from "@/shared/ui";

/** A slim line above a member's map: which circle it belongs to, and a way back to it. */
export function CircleBanner({ code, title }: { code: string; title: string }) {
  return (
    <p className="flex items-center gap-2 border-b border-proven/30 bg-proven/10 px-4 py-2 text-sm sm:px-6">
      <Users aria-hidden="true" size={16} className="shrink-0 text-proven" />
      <span className="min-w-0 truncate">In circle: {title}</span>
      <span aria-hidden="true">·</span>
      <Link href={`/circle/${code}`} className="shrink-0 text-accent-bright underline underline-offset-4">
        View circle
      </Link>
    </p>
  );
}

/**
 * In the map header, in place of "Start a study circle", once the map belongs to a circle:
 * one button back to the circle, so the map needs no extra row for it.
 */
export function CircleLink({ code, title }: { code: string; title: string }) {
  return (
    <Link href={`/circle/${code}`} title={`In circle: ${title}`} className={buttonClasses("secondary", "sm")}>
      <Users aria-hidden="true" size={16} className="text-proven" />
      Your circle
      <span className="sr-only">: {title}</span>
    </Link>
  );
}
