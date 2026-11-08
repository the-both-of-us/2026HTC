# skill-map/ui

The map screen. `MapScreen` is the only thing other code needs: import it from `@/features/skill-map/client`.

- `MapScreen.tsx`: loads the map and progress, holds the selected skill and view, handles a proven skill.
- `MapActions.tsx`: the header's buttons. One row on large screens; on a phone only the next skill and a "More" menu with the rest, labelled, so the map starts near the top (about 220 px down at 390x844).
- `MapCanvas.tsx`: the graph (`@xyflow/react`). Positions come from `layout.ts`; progress never moves anything. With `compact` it is a read-only map for a study circle: smaller title-only cards (`COMPACT_METRICS`) that always fit the whole map and refit on resize, text sized against the zoom so titles stay 15px or more on screen, and `avatars` (initials, names in the tooltip) under each card. A phone pans instead when fitting would make titles too small.
- `layout.ts`: pure top-to-bottom layout (longest path, barycentre ordering, waypoints for long lines). `layoutGraph(nodes, metrics?)` takes the card size and gaps. Tests in `layout.test.ts`.
- `SkillNodeView.tsx`, `SkillEdge.tsx`: one node, one line.
- `SkillList.tsx`: the same skills as plain lists. The default on phones, and the screen reader route.
- `SkillPanel.tsx`: a panel beside the map on large screens, a bottom sheet on phones. Hosts `TeachBackPanel` from `@/features/teachback/client`.
- `map.css`: all motion, inside `prefers-reduced-motion: no-preference`.

Keyboard: Tab moves through skills row by row, arrow keys move between the Knowledge Map and All Skills tabs, Enter opens one, Escape closes the panel (not while typing). After a skill is proven, focus moves to the button for the next skill it opens.
