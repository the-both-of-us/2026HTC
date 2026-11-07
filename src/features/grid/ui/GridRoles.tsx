import { ArrowRight, BarChart3, HardHat, RadioTower, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { buttonClasses, Card } from "@/shared/ui";

type RoleNote = { title: string; icon: LucideIcon; text: string };

const ROLES: RoleNote[] = [
  {
    title: "Grid analyst",
    icon: BarChart3,
    text: "Turns these numbers into reports and forecasts. Wind's share, net load and capacity factor are everyday measures, and the work is explaining why they moved.",
  },
  {
    title: "System operator",
    icon: RadioTower,
    text: "Keeps supply and demand matched, minute by minute. Headroom, reserve and the flows to neighbouring provinces and states show how much room there is if something fails.",
  },
  {
    title: "Field technician",
    icon: HardHat,
    text: "Keeps assets running. Knowing what the fleet is producing right now helps separate a calm day from a turbine that needs a visit.",
  },
];

/** Who uses this reading in real work, and the way into the skill map. */
export function GridRoles() {
  return (
    <div className="flex flex-col gap-5">
      <ul className="grid gap-4 md:grid-cols-3">
        {ROLES.map(({ title, icon: Icon, text }) => (
          <li key={title}>
            <Card className="flex h-full flex-col gap-2">
              <h3 className="flex items-center gap-2 text-lg font-bold">
                <Icon size={18} aria-hidden="true" />
                {title}
              </h3>
              <p className="text-sm text-ink-soft">{text}</p>
            </Card>
          </li>
        ))}
      </ul>
      <Card className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xl font-bold">Grid operations career path</h3>
          <p className="text-sm text-ink-soft">
            Turn a sample grid analyst posting into a skill map, then prove each skill by teaching it back.
          </p>
        </div>
        <Link href="/?sample=data-analyst-grid" className={`${buttonClasses("primary")} shrink-0`}>
          Build the skill map
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </Card>
    </div>
  );
}
