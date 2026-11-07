import { StateMark } from "@/shared/ui";

/** Shown instead of the prompt until the skills this one builds on are proven. */
export function LockedNotice({
  skillTitle,
  prerequisites,
}: {
  skillTitle: string;
  prerequisites: string[];
}) {
  return (
    <div className="hatch-locked flex flex-col gap-3 rounded-sheet border-2 border-dashed border-locked p-5">
      <h3 className="text-xl font-semibold">{skillTitle} is locked</h3>
      <p>
        {prerequisites.length === 1
          ? "It opens when you prove this skill:"
          : "It opens when you prove these skills:"}
      </p>
      <ul className="flex flex-col gap-2">
        {prerequisites.map((title) => (
          <li key={title} className="flex items-center gap-2 font-semibold">
            <StateMark state="available" size={16} className="shrink-0" />
            {title}
          </li>
        ))}
      </ul>
    </div>
  );
}
