import type { SkillNode } from "@/shared/types";

export type QuizTabProps = {
  mapId: string;
  skill: SkillNode;
};

/** Rendered inside the skill panel on the map. Placeholder until built. */
export function QuizTab({ skill }: QuizTabProps) {
  return (
    <section className="border-t border-rule pt-5">
      <h3 className="mb-1 text-base font-semibold">Quiz</h3>
      <p className="text-sm text-ink-soft">Quiz for {skill.title} are coming soon.</p>
    </section>
  );
}
