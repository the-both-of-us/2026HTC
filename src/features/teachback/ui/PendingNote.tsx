import { useEffect, useState } from "react";

/** After this long, the note also shows the real time spent waiting. */
const SHOW_SECONDS_AFTER = 8;

/** Says what is happening while a button's spinner turns. Mounted only for as long as the wait. */
export function PendingNote({ message }: { message: string }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <p className="rounded-control bg-raised/60 px-3.5 py-2.5 text-sm text-ink-soft">
      {message}
      {seconds >= SHOW_SECONDS_AFTER && ` ${seconds} seconds so far.`}
    </p>
  );
}
