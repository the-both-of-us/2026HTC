# skill-map/ui

The map screen. `MapScreen` is the only thing other code needs: import it from `@/features/skill-map/client`.

- `MapScreen.tsx`: loads the map and progress, holds the selected skill and view, handles a proven skill.
- `MapCanvas.tsx`: the graph (`@xyflow/react`). Positions come from `layout.ts`; progress never moves anything.
- `layout.ts`: pure top-to-bottom layout (longest path, barycentre ordering, waypoints for long lines). Tests in `layout.test.ts`.
- `SkillNodeView.tsx`, `SkillEdge.tsx`: one node, one line.
- `SkillList.tsx`: the same skills as plain lists. The default on phones, and the screen reader route.
- `SkillPanel.tsx`: a panel beside the map on large screens, a bottom sheet on phones. Hosts `TeachBackPanel` from `@/features/teachback/client`.
- `map.css`: all motion, inside `prefers-reduced-motion: no-preference`.

Keyboard: Tab moves through skills row by row, arrow keys move between the Knowledge Map and All Skills tabs, Enter opens one, Escape closes the panel (not while typing). After a skill is proven, focus moves to the button for the next skill it opens.
