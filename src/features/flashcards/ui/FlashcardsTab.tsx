import type { SkillNode } from "@/shared/types";

export type FlashcardsTabProps = {
  mapId: string;
  skill: SkillNode;
};

/** Rendered inside the skill panel on the map. Placeholder until built. */
export function FlashcardsTab({ skill }: FlashcardsTabProps) {
  return (
    <section className="border-t border-rule pt-5">
      <h3 className="mb-1 text-base font-semibold">Flashcards</h3>
      <p className="text-sm text-ink-soft">Flashcards for {skill.title} are coming soon.</p>
    </section>
  );
}
