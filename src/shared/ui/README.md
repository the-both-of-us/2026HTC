# shared/ui

The design system. Import from `@/shared/ui`. Tokens live in `src/app/globals.css` and work as Tailwind classes (`bg-paper`, `text-ink-soft`, `border-control-edge`, `font-display`).

- `PageShell`: skip link, header, `<main>`. `width` is `reading`, `wide` or `full`.
- `Button`: `variant` is `primary`, `secondary`, `subtle` or `quiet`; `size` is `sm`, `md` or `lg`; `pending` shows a spinner. `buttonClasses()` styles a `<Link>` the same way.
- `Card`: a sheet of paper on the page.
- `Field` and `Textarea`: label, hint and error linked to the input. `ruled` draws field-book lines.
- `Badge`: `tone` is `neutral`, `sample`, `danger`, `locked`, `available` or `proven`.
- `StateMark`: the map symbol for a node state. Filled triangle = proven, hollow triangle = available, dashed circle = locked.
- `Spinner`, `ErrorNotice` (a plain sentence and a retry button).

## Node states on the map

| State | Symbol | Surface | Edge |
|---|---|---|---|
| locked | dashed circle | `hatch-locked` | 2px dashed `border-locked`, text `text-ink-soft` |
| available | hollow triangle | `bg-available-surface` | 3px solid `border-available` |
| proven | filled triangle | `bg-proven-surface`, text `text-on-proven` | solid `border-proven` |

Avoid: soft shadows, gradients, all-caps labels, monospace labels. Motion goes inside the `prefers-reduced-motion: no-preference` block in `globals.css`.
