"use client";

import { useId, useState, type ReactNode } from "react";
import { PanelVisibleContext, tabId, Tabs } from "@/shared/ui";

export type StudyTab = { id: string; label: string; content: ReactNode;
  /** Mounted only once the tab is first opened, for content that costs a lookup. */
  lazy?: boolean;
};

/**
 * Read, Flashcards and Quiz for one skill. Every panel stays mounted and is only hidden,
 * so switching tabs keeps your place in a deck or a quiz.
 */
export function StudyTabs({ tabs }: { tabs: StudyTab[] }) {
  const [selected, setSelected] = useState(tabs[0]?.id ?? "");
  const [opened, setOpened] = useState<string[]>([]);
  const idPrefix = useId();
  const panelId = `${idPrefix}-panel`;

  return (
    <section className="flex flex-col gap-4 border-t border-rule pt-5">
      <Tabs
        label="Study this skill"
        items={tabs}
        value={selected}
        onChange={(next) => {
          setSelected(next);
          setOpened((ids) => (ids.includes(next) ? ids : [...ids, next]));
        }}
        idPrefix={idPrefix}
        panelId={panelId}
        className="border-b border-rule"
      />
      {tabs.map((tab) => {
        const active = tab.id === selected;
        return (
          <div
            key={tab.id}
            role={active ? "tabpanel" : undefined}
            id={active ? panelId : undefined}
            aria-labelledby={active ? tabId(idPrefix, tab.id) : undefined}
            hidden={!active}
            // The Flashcards and Quiz parts draw their own top rule, which a tab does not need.
            className="[&>section]:border-t-0 [&>section]:pt-0"
          >
            <PanelVisibleContext value={active}>{tab.lazy && !active && !opened.includes(tab.id) ? null : tab.content}</PanelVisibleContext>
          </div>
        );
      })}
    </section>
  );
}
