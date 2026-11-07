import { FAMILY_ORDER, mw } from "../metrics";
import type { FuelGroup, GridSnapshot } from "../types";
import { FAMILY_COLOR, trackColor } from "./fuelStyle";

function sortedGroups(snapshot: GridSnapshot): FuelGroup[] {
  return [...snapshot.groups].sort(
    (a, b) =>
      FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family) || b.capability - a.capability,
  );
}

function usage(group: FuelGroup): number {
  return group.capability > 0 ? Math.round((group.output / group.capability) * 100) : 0;
}

/** Each fuel group's full capability as a track, with what it is producing now filled in. */
export function CapabilityChart({ snapshot }: { snapshot: GridSnapshot }) {
  const groups = sortedGroups(snapshot);
  const largest = Math.max(1, ...groups.map((group) => group.capability));

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {groups.map((group) => {
          const fill = group.capability > 0 ? Math.min(group.output / group.capability, 1) : 0;
          return (
            <li key={group.name} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="font-semibold">{group.name}</span>
                <span className="text-ink-soft tabular-nums">
                  {group.output < 0
                    ? `Charging ${mw(-group.output)} MW`
                    : `${mw(group.output)} of ${mw(group.capability)} MW, ${usage(group)}%`}
                </span>
              </div>
              <div
                aria-hidden="true"
                className="h-3 rounded-r-[4px]"
                style={{
                  width: `${(group.capability / largest) * 100}%`,
                  backgroundColor: trackColor(group.family),
                }}
              >
                <div
                  className="h-full rounded-r-[4px] motion-safe:transition-[width] motion-safe:duration-700"
                  style={{
                    width: `${Math.max(fill, 0) * 100}%`,
                    backgroundColor: FAMILY_COLOR[group.family],
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">See these figures as a table</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-right tabular-nums">
            <caption className="sr-only">Generation by fuel group, in MW, from AESO</caption>
            <thead className="text-ink-soft">
              <tr className="border-b border-control-edge">
                <th scope="col" className="py-1.5 pr-3 text-left font-semibold">Fuel group</th>
                <th scope="col" className="px-3 py-1.5 font-semibold">Capability</th>
                <th scope="col" className="px-3 py-1.5 font-semibold">Output</th>
                <th scope="col" className="px-3 py-1.5 font-semibold">In use</th>
                <th scope="col" className="py-1.5 pl-3 font-semibold">Reserve</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.name} className="border-b border-rule">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">{group.name}</th>
                  <td className="px-3 py-1.5">{mw(group.capability)}</td>
                  <td className="px-3 py-1.5">{mw(group.output)}</td>
                  <td className="px-3 py-1.5">{usage(group)}%</td>
                  <td className="py-1.5 pl-3">{group.reserve === null ? "Not given" : mw(group.reserve)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
