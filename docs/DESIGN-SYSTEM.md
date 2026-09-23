# YoHoBed Design System — "Ink Navy & Brass"

> The visual contract for every screen in YoHoBed 2.0. Established in the global-look overhaul
> (2026-08-24). The information architecture mirrors Yanolja Cloud Solution so migrating staff feel
> at home; the execution is deliberately more premium — calmer color, real typography, purposeful
> motion. Every later per-screen phase (Dashboard, Stay View, ARI, Cashiering …) must follow this
> document rather than inventing local styles.
>
> Its behavioural twin is [UX-STANDARD.md](UX-STANDARD.md) (2026-09-22). This document governs how
> a screen looks; that one governs how it behaves: click budgets, safety rules, errors, alerts,
> help and measurement. Both are binding.

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
`variant="panel"` for rich hover cards), `ContextMenu` (right-click; a shortcut, never the only way).

Patterns: `CountedChips` (active = dark navy filled pill), `DataGrid` (TanStack; `surface-2` header
band, optional sticky header), `MoneyFooter` (Total/Paid/red Balance), `MetricFooter`,
`AuditTrailDrawer`, `StatCard` (KPI tile: tinted icon square + label + tabular number), `Toaster` +
`toast` (sonner, mounted once in `providers.tsx`).

The reservation desk (Development Phase 02). These components were built to Yanolja's screenshots,
and each one accepts typing as well as clicking:

- **`Calendar`** — Sunday-first, `« ‹ Sep 2026 › »`. Days before `min` (the hotel's date, not the
  browser's) are greyed and disabled, today has a brass ring and the chosen day is a navy square.
  The keyboard moves the focus through the days.
- **`DatePicker`** — accepts `dd/mm/yyyy` or ISO, plus a calendar popover.
- **`TimePicker`** — `02:00 PM` or `14:00`, plus Yanolja's hour/minute/AM-PM wheel with **Ok**.
- **`StayRangeField`** — check-in date and time, an editable **Nights** chip, then check-out date
  and time.
- **`NumberStepper`** — a number with up/down buttons.
- **`Combobox`** — a searchable select with optional groups, a prefix dot and a hint (cmdk).
- **`CountrySelect`** and **`PhoneInput`** — country code plus number. The phone number is read in
  the hotel's country and handed back as E.164.
- **`InlineAlert`** — info, warn, error or success, for feedback inside a form.
- **`SummaryList`** — label and money rows, for the Billing Summary.
- **`ConfirmDialog`** — the safe choice is focused first.

Changes to existing components:

- `Sheet` has `size="half"`.
- `Field` has `htmlFor`, which labels by id instead of wrapping. Use it for composite controls.
- `SelectItem` has a list-only `hint`, and the trigger never wraps.
- `Select` ignores the empty-string echo from Radix's hidden native `<select>`.
- `Checkbox` supports `checked="indeterminate"`.
- `TagChip`, `TagDot` and `TagColorPicker` use the categorical palette.
- `DataGrid` (Sprint 4), all optional: `selection` (a checkbox column with select-all for the
  page), `columnVisibility` from `useColumnVisibility(gridId, hiddenByDefault)` — remembered per
  grid in the browser — edited by **`ManageColumns`**, server `pagination` (`1–25 of 132`, rows
  per page, previous/next; turns client sorting off), `rowActions` (a trailing ⋮ column),
  `stickyFirstColumn`, `density="compact"` for wide operational lists, and `minWidth` below which
  it scrolls sideways. The scroll box is `relative`, so nothing inside it (a screen-reader-only
  label) can widen the page on a phone.

### The Stay View calendar (`components/stayview/`)

The calendar has its own small visual language, defined once in `globals.css` (section "Stay View
calendar") and driven by data attributes, so the grid never re-renders to change a highlight:

- **States.** `.sv-bar[data-state]` is one of `inhouse`, `confirmed`, `pending`, `hold`, `tentative`,
  `checkedout`, `noshow`, `cancelled`, `out_of_service` or `blocked`. Each state has fill, edge and
  ink tokens (`--stay-*`) for both themes. In-house is the only solid fill. Pending is dashed,
  a hold is striped, and blocks are hatched (Blocked in neutral, Out of service in red). Every
  state also carries its Phosphor icon (`STATE_ICON`) and a label (`STATE_META`), because colour
  is never the only signal.
- **Geometry.** The column width is `--col-w`, set on `.sv-grid` from the measured width: the
  window fits the screen, down to a minimum per density, then scrolls sideways. Bars are placed
  with `calc(var(--col-w) * n)`. A solid 3px leading edge marks the arrival night. A square,
  faded edge means the stay began before the window. Rounded ends are real arrivals and
  departures.
- **Interaction states**, each one different:

  | State                      | How it shows                                               |
  | -------------------------- | ---------------------------------------------------------- |
  | hover                      | brightness plus hairline                                   |
  | keyboard focus             | brass outline                                              |
  | selected                   | brass ring plus lift                                       |
  | linked split-stay segments | thin brass ring                                            |
  | search or located result   | brass pulse (`data-flash`)                                 |
  | dimmed by a filter         | 28% opacity                                                |
  | drag source                | 35% opacity                                                |
  | drop target                | `data-drop="ok\|no"`: green or red tint with an inset line |
  | selected nights            | brass-tinted range with end handles                        |
  | today                      | an info-blue column                                        |

- **Motion** uses the existing `--dur-*` and `--ease-smooth`:
  - a 150ms hover card that fades and rises 3px
  - a 200ms content swap inside the side panel
  - group folding by grid-rows height (opacity only above 30 rooms)
  - a one-off flash and shake
  - reduced motion collapses all of it through the global rule
- **Surfaces**:
  - a single non-modal right panel (`PanelHost`) whose content switches in place
  - filters, settings and the legend in popovers
  - reviews in centred dialogs
  - a context menu (`ContextMenu`, new in the kit) that only repeats what those surfaces already
    offer

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
