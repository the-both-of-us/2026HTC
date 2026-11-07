# shared/ui

The design system. Import from `@/shared/ui`. Tokens live in `src/app/globals.css` and work as Tailwind classes (`bg-paper`, `bg-sheet`, `bg-raised`, `text-ink-soft`, `border-rule-strong`, `border-control-edge`, `text-accent-bright`, `shadow-glow`).

- `PageShell`: skip link, sidebar, phone top bar, `<main>`. `width` is `reading`, `wide` or `full`.
- `LogoMark`: the small accent tile with the oryx's horns.
- `Button`: `variant` is `primary`, `secondary`, `subtle` or `quiet`; `size` is `sm`, `md` or `lg`; `pending` shows a spinner. `buttonClasses()` styles a `<Link>` the same way.
- `Card`: a raised rounded surface.
- `Field` and `Textarea`: label, hint and error linked to the input.
- `Badge`: a pill. `tone` is `neutral`, `sample`, `danger`, `locked`, `available` or `proven`.
- `StateMark`: the status dot for a node state. Tick in a filled circle = proven, dot in a ring = available, dashed ring = locked.
- `Spinner`, `ErrorNotice` (a plain sentence and a retry button).

## Node states on the map

| State | Mark | Surface | Edge |
|---|---|---|---|
| locked | dashed ring, plus a lock icon on the map | `bg-locked-surface`, text `text-ink-soft` | dashed, dimmed `border-locked` |
| available | dot in a ring | `bg-available-surface`, `shadow-glow` | solid `border-accent` |
| proven | tick in a filled circle | `bg-proven-surface` | solid `border-proven` |

Fonts: Outfit for everything, Cormorant (`font-serif`) only for big moments such as the landing headline and the "Proven" verdict. Motion goes inside the `prefers-reduced-motion: no-preference` block in `globals.css`.
