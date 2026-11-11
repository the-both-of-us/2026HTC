import type { ReactNode } from "react";
import { FriendsPrivacySettings } from "@/features/network/client";
import { Card, LearningModeToggle, PageShell, TextSizeSelect, ThemeSelect } from "@/shared/ui";

/** /settings: appearance and accessibility (kept in this browser), and friends and privacy (kept with your network profile). */
export function SettingsScreen() {
  return (
    <PageShell width="reading">
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-3">
          <h1 className="font-serif text-4xl font-medium tracking-tight sm:text-5xl">Settings</h1>
          <p className="text-lg text-ink-soft">How OryxLearn looks and reads, and who can see you.</p>
        </header>

        <Section title="Display">
          <Card className="flex flex-col gap-5 sm:flex-row">
            <ThemeSelect className="sm:flex-1" />
            <TextSizeSelect className="sm:flex-1" />
          </Card>
          <Note>Saved in this browser only.</Note>
        </Section>

        <Section title="Accessibility">
          <Card className="flex flex-col gap-3">
            <LearningModeToggle className="-mx-2 self-start" />
            <p className="text-ink-soft">
              An easier-to-read font, larger text and spacing, no motion, and a Read aloud button on
              lessons and questions. Everything also works with a keyboard: on the map, Tab moves
              between skills, Enter opens one and Escape closes it.
            </p>
          </Card>
          <Note>Saved in this browser only.</Note>
        </Section>

        <Section title="Friends and privacy">
          <FriendsPrivacySettings />
          <Note>Saved with your network profile.</Note>
        </Section>
      </div>
    </PageShell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = `${title.toLowerCase().replace(/[^a-z]+/g, "-")}-title`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-2xl font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-soft">{children}</p>;
}
