# YoHoBed Design System — "Ink Navy & Brass"

> The visual contract for every screen in YoHoBed 2.0. Established in the global-look overhaul
> (2026-08-24). The information architecture mirrors Yanolja Cloud Solution so migrating staff feel
> at home; the execution is deliberately more premium — calmer color, real typography, purposeful
> motion. Every later per-screen phase (Dashboard, Stay View, ARI, Cashiering …) must follow this
> document rather than inventing local styles.

## 1. Principles

1. **Tokens or nothing.** Every color in the product resolves to a CSS custom property defined in
   `apps/web-extranet/app/globals.css`. Hex/rgba literals are allowed in that file only. The single
   exception: pure white/black _alpha effects_ (photo scrims, hatch overlays, `text-white` on brand
   or status fills) — those are effects, not palette.
2. **Light-first, dark-complete.** `:root` is the light theme; `:root[data-theme='dark']` overrides
   it. `ThemeScript` stamps the attribute pre-paint (default `light`; localStorage `yhb_theme`
   wins). Never write a style that only works in one theme.
3. **One kit.** All UI comes from `@yohobed/ui`. The legacy `components/ui.tsx` kit is deleted;
   never reintroduce a second source of primitives.
4. **Dense, not cramped.** This is an 8-hours-a-day operations tool: 13–14px body in grids,
   generous hit areas, information density over whitespace theatrics.

## 2. Color

Families: structure (`bg, surface, surface-2, ink, ink-2, ink-3, line, line-strong`), brand
(`brand, brand-ink, brand-soft` — deep ink navy `#16243D`), accent (`brass, brass-ink, brass-soft`
— `#A8823C`), and four status families each shaped `base / -ink / -soft`:

| Family   | Meaning                                   | Examples                                     |
| -------- | ----------------------------------------- | -------------------------------------------- |
| `avail`  | available / confirmed / success           | confirmed bars, Active chips, success toasts |
| `low`    | attention / low stock / warnings          | pending, low-availability counts, VIP crown  |
| `closed` | closed / due-out / danger / balances owed | danger buttons, red Balance, stopsells       |
| `info`   | neutral information                       | info badges, links in feeds                  |

Rules:

- **`brand` fills, `brand-ink` text, `brand-soft` tint.** Primary buttons are dark navy with white
  text (Yanolja's language). Same shape for every status family.
- **Brass is the signature, used sparingly:** focus rings, the active-nav marker, `::selection`,
  premium highlights (revenue stat icon). It is never a status color and never a button fill.
- Status colors mark status — never decoration.
- Text on `bg`/`surface` must hold WCAG AA: use `ink` (primary), `ink-2` (secondary), `ink-3`
  (meta — smallest size 11px).

Tailwind classes exist for every token (`bg-brand-soft`, `text-closed-ink`, `border-line-strong` …)
via the shared preset `@yohobed/ui/tailwind-preset`. **Never** write `bg-[var(--x)]` arbitrary
values — if a class is missing, add it to the preset.

## 3. Typography

- **IBM Plex Sans** (400/500/600/700) for UI, **IBM Plex Mono** (400/500/600) for codes,
  references, timestamps, and money — loaded via `next/font` in `app/layout.tsx`, exposed as
  `--font-sans`/`--font-mono`, mapped to `font-sans`/`font-mono`.
- Scale: page title `text-2xl font-semibold tracking-tight` (only via `PageHeader` — the app has
  exactly one H1 style); sheet/dialog titles `text-base font-semibold tracking-tight`; section
  headings `text-sm font-semibold`; body `text-sm`; meta `text-xs`; micro-labels
  `text-[11px] font-semibold uppercase tracking-wider` (group labels, table headers, eyebrows).
- **All money and counts:** `font-mono tabular-nums`. No inline `fontVariantNumeric` styles.

## 4. Geometry & elevation

- Radius tokens: controls `rounded-lg` (8px), surfaces/cards `rounded-xl` (10px), overlays
  `rounded-2xl` (14px), pills/chips `rounded-full`, nested list items `rounded-md` (6px).
- Shadows: `shadow-card` (resting cards), `shadow-raised` (menus, popovers, tooltips),
  `shadow-overlay` (sheets, dialogs, toasts). All var-driven and dark-theme aware — never use
  Tailwind's default `shadow-*` scale or arbitrary shadow values.
- Hairline borders (`border-line`; `border-line-strong` for interactive control borders).

## 5. Motion

- Tokens: `--dur-1` 120ms (hovers, presses), `--dur-2` 180ms (menus, popovers, palette),
  `--dur-3` 260ms (sheets); easings `--ease-smooth` (default) and `--ease-spring` (playful
  emphasis, rare). Tailwind: `duration-1|2|3`, `ease-smooth`, `ease-spring`.
- Floating panels animate via `tailwindcss-animate` (`animate-in fade-in-0 zoom-in-95` +
  side-aware slides); sheets slide from their edge. Skeletons: `animate-pulse`, or the
  `shimmer` variant for tables.
- `prefers-reduced-motion` collapses all animation globally (globals.css) — never opt out.
- Buttons: `active:translate-y-px` press; no bouncing, no parallax, nothing over 300ms.

## 6. Iconography

- **Phosphor only** (`@phosphor-icons/react`). lucide-react is removed from the workspace.
- Weights: `regular` everywhere; **`duotone` marks the active nav item and quick-menu tiles**;
  `fill` for tiny state glyphs (filled stars); `bold` for 12px carets/checks.
- Sizes: 16 default inline · 18 header icon buttons · 12 dense meta (VIP crown, sort carets)
  · 20 quick-menu tiles. Align to text with `shrink-0`.

## 7. Components (`packages/ui`)

Primitives: `Button` (primary/secondary/ghost/outline/danger · sm/md/icon · `loading` spinner ·
`asChild`), `Input`, `Textarea`, `Field` (label/hint/error — an error tints the control border),
`Select` family, `Switch`, `Checkbox`, `Tabs` (+counts), `SegmentedControl` (view toggles), `Card`,
`Badge` (tones; leading dot), `Kbd`, `Skeleton` (+`shimmer`), `EmptyState` (default tray glyph),
`PageHeader`, `Sheet` (right slide-over — the default detail/edit surface), `Dialog` (centered —
palette, confirmations), `Menu` (+styled submenus), `Popover`, `Tooltip` (`chip` inverted default;
`variant="panel"` for rich hover cards).

Patterns: `CountedChips` (active = dark navy filled pill), `DataGrid` (TanStack; `surface-2` header
band, optional sticky header), `MoneyFooter` (Total/Paid/red Balance), `MetricFooter`,
`AuditTrailDrawer`, `StatCard` (KPI tile: tinted icon square + label + tabular number), `Toaster` +
`toast` (sonner, mounted once in `providers.tsx`).

Conventions:

- Every page starts with `PageHeader` (eyebrow = its sidebar group).
- Detail/edit opens in a right `Sheet` with a sticky footer: `Cancel` (outline) + one dark primary.
- One dark primary action per toolbar; everything else `secondary`/`outline` with a leading icon.
- Empty lists render `EmptyState` (+ CTA when the user can create the thing).
- Transient feedback = `toast.success/error`; persistent validation stays inline
  (`bg-closed-soft text-closed-ink` banner).
- Focus is always the brass ring — components provide it; never hand-roll outlines.

## 8. Shell

`components/app-shell.tsx`: h-14 header (property identity + working switcher · centered
rounded-full omni-search `Ctrl K` · quick-action icon strip · Quick Menu grid (`DotsNine`) ·
notification bell (Popover, 20s poll) · theme toggle · profile menu with currency row). Sidebar
264px: collapsible at `xl` (hamburger, persisted `yhb_nav_collapsed`), overlay drawer below;
active item = `brand-soft` band + brass left bar + duotone icon; brand footer with the `Logo`
(ink tile + brass dot + drawn bed). Public pages share `components/auth-shell.tsx` (ambient
brand/brass glows). The palette is a centered `Dialog` on cmdk.

## 9. Enforcement (run before shipping any screen)

From `apps/web-extranet`, all of these must return nothing:

```
rg "from '@/components/ui'" app components
rg "lucide-react" .
rg "\[var\(--" app components          # arbitrary-value token classes
rg "#[0-9a-fA-F]{3,8}|rgba\(" app components   # allow-list: globals.css, logo.tsx (#fff on brand), print CSS, photo/hatch alpha effects
rg "text-3xl" app                       # page titles come from PageHeader
rg "!p[xy]-" app components             # size props, not overrides
```

Plus `pnpm -w typecheck`, `pnpm --filter @yohobed/web-extranet build`, and the Playwright suite.
