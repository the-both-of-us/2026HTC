# shared/ui

The design system, **Seal**: security-paper green, deep viridian ink, and a teal to violet to magenta foil used only on proven things. Square corners, one typeface (Mona Sans) at different widths. Import from `@/shared/ui`. Tokens live in `src/app/globals.css` and work as Tailwind classes (`bg-paper`, `bg-sheet`, `bg-raised`, `bg-ink`, `text-ink-soft`, `text-on-ink`, `border-rule-strong`, `border-control-edge`, `text-proven`, `shadow-press`). Never hard-code a colour: use a token, so the theme can change in one place.

- `PageShell`: skip link, the sidebar (a top bar with a "Menu" button on phones), `<main>`. `width` is `reading`, `wide` or `full`. The sidebar footer holds only the account line; `ThemeSelect`, `TextSizeSelect` and `LearningModeToggle` live on /settings (the `settings` feature).
- `TextSizeSelect` / `textSize.ts`: Default, Large (112.5%) or Larger (125%), kept in localStorage and set as the root font size before paint by `TEXT_SIZE_SCRIPT` in the root layout, so every rem scales and globals.css needs no rule.
- `LogoMark`: a small ink guilloche seal.
- `Button`: `variant` is `primary` (solid ink on a pressed-die shadow), `secondary` (ink outline), `subtle` or `quiet` (an underlined word); `size` is `sm`, `md` or `lg`; `pending` shows a spinner. `buttonClasses()` styles a `<Link>` the same way.
- `Tabs`: plain words, the chosen one a solid block of ink. Arrow keys, Home and End. Pair with one `role="tabpanel"` whose `aria-labelledby` is `tabId(idPrefix, value)`.
- `Card`: a raised sheet with a 1px rule.
- `Field`, `Textarea`, `TextInput`: a 1.5px ink edge on a blank sheet; label, hint and error linked to the input.
- `Badge`: a square label. `tone` is `neutral`, `sample` (dashed), `danger`, `locked` (dashed), `available` or `proven` (solid ink).
- `StateMark`: solid ink disc with a tick = proven, open ring = available, dotted ring = locked.
- `Seal` (`seal/`): `<Seal fingerprint size state />` draws a guilloche seal from any string (a SHA-256 hex digest is used as it is). `state` is `proven` (ink and foil), `ink` or `on-ink` (for an ink band). Pure and memoised: `sealDrawing()` returns path data with no DOM, and a node-size seal stays under 24k characters of path data, so ten on a map stay light. `SealBlank` is the unstruck blank with a reeded edge.
- `Spinner`, `ErrorNotice` (a plain sentence and a retry button).

Fonts: Mona Sans everywhere, via next/font with the width axis. Headlines (`h1`, `font-serif`) are set at 125% width; `h2` and `h3` at 112%. Accessible Learning Mode swaps in Lexend. Focus is a 3px ink outline (paper-coloured inside `.on-ink`). Motion goes inside the `prefers-reduced-motion: no-preference` block in `globals.css`, or uses `motion-safe:`.
