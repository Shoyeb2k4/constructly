# Design System — "Blueprint"

_The product's visual foundation. Premium, minimal, elegant — inspired by Linear, Notion,
Vercel, Stripe, Arc, and Apple HIG. Built before any business screen (ADR-0012)._

Everything here compiles to CSS variables + Tailwind theme tokens and shadcn/ui component
variants. Nothing hardcoded in screens.

## 1. Design principles
1. **Calm surfaces.** Near-monochrome canvas; color earns attention (status, primary action).
2. **Space over borders.** Separate with whitespace and subtle elevation, not heavy lines.
3. **Content first.** Data is the hero; chrome recedes.
4. **Fast & quiet motion.** 150–200ms, ease-out; motion clarifies, never decorates.
5. **Legible numbers.** Money, codes, and quantities use tabular/mono figures.
6. **Dark mode is first-class**, not an afterthought.

## 2. Color tokens (semantic → value)

Neutral canvas uses a slightly cool slate. One restrained primary accent ("Blueprint blue").
Status colors are muted, not neon.

### Light
| Token | Value | Use |
|---|---|---|
| `--bg` | `#FBFBFD` | app canvas |
| `--surface` | `#FFFFFF` | cards, sheets |
| `--surface-muted` | `#F4F5F7` | subtle fills, hover |
| `--border` | `#E9EAEE` | hairline dividers |
| `--text` | `#16181D` | primary text |
| `--text-muted` | `#5C6270` | secondary text |
| `--text-subtle` | `#8A909E` | tertiary / placeholder |
| `--primary` | `#2E5BFF` | primary actions, active nav |
| `--primary-hover` | `#2449D6` | |
| `--primary-fg` | `#FFFFFF` | text on primary |
| `--success` | `#0E9F6E` | on-track, present |
| `--warning` | `#D98A00` | budget near/over, half-day |
| `--danger` | `#E02424` | overdue, absent, destructive |
| `--info` | `#2E5BFF` | informational |

### Dark
| Token | Value |
|---|---|
| `--bg` | `#0B0C0F` |
| `--surface` | `#141619` |
| `--surface-muted` | `#1C1F24` |
| `--border` | `#262A31` |
| `--text` | `#F2F3F5` |
| `--text-muted` | `#A0A6B0` |
| `--text-subtle` | `#6C727E` |
| `--primary` | `#4B77FF` |

Each status color has `-subtle` background variants (e.g. `--success-subtle`) for badges/pills.
_Accent is provisional — amber ("safety/construction") is the alternate under review._

## 3. Typography
- **Sans:** Inter (UI). **Mono:** Geist Mono / JetBrains Mono (codes, money, IDs — tabular).
- Scale (rem): `xs .75 / sm .875 / base 1 / lg 1.125 / xl 1.25 / 2xl 1.5 / 3xl 1.875 / 4xl 2.25`.
- Weights: 400 body, 500 medium (labels), 600 semibold (headings). Avoid heavy 700+ except display.
- Line-height: 1.5 body, 1.2 headings. Tracking slightly tight on large headings.

## 4. Spacing & layout
- **4px base grid.** Scale: 0,1(4),2(8),3(12),4(16),5(20),6(24),8(32),10(40),12(48),16(64).
- Content max-width ~1200px; comfortable gutters. Generous card padding (20–24px).
- Density: roomy default; a compact table mode available where data demands it.

## 5. Radius, elevation, borders
- Radius: `sm 6 / md 8 / lg 12 / xl 16 / full`. Controls 8, cards 12.
- Shadows: low-opacity, layered — `sm` (hairline lift), `md` (cards on hover), `lg` (popovers/modals). No hard drop shadows.
- Borders: 1px hairline `--border`, used sparingly.

## 6. Motion
- Durations: `fast 120ms / base 160ms / slow 220ms`. Easing: `ease-out` enter, `ease-in` exit.
- Page/route transitions subtle; list items stagger ≤ 30ms. Respect `prefers-reduced-motion`.

## 7. Iconography
- Lucide (consistent, minimal line icons). 1.5px stroke, 20/24px sizes. No filled/colored icons in nav.

## 8. Core components (design-system inventory)
Primitives (shadcn-based): Button (primary/secondary/ghost/danger), Input, Select, Combobox,
Checkbox, Switch, Textarea, Badge/Pill (status variants), Avatar, Tooltip, Dropdown, Dialog/Sheet,
Tabs, Toast, Card, Table/DataView, Pagination, Breadcrumb, SegmentedControl, DatePicker, FileDrop.

App patterns: `AppShell` (sidebar + topbar), `PageHeader`, `StatCard`, `EmptyState`,
`LoadingState` (skeletons), `ErrorState`, `ConfirmDialog`, `MoneyText`, `StatusBadge`,
`OfflineIndicator`, `SyncStatus`.

## 9. State patterns (mandatory for every view)
- **Empty:** friendly illustration + one-line explanation + primary CTA. Never a blank screen.
- **Loading:** content-shaped **skeletons**, not spinners, for lists/cards. Optimistic UI where offline.
- **Error:** plain-language message + retry; technical detail behind a disclosure.
- **Offline:** persistent subtle indicator + per-item sync status (pending/synced/conflict).

## 10. Accessibility
WCAG 2.1 AA: contrast ≥ 4.5:1 body, visible focus rings, full keyboard nav (Radix gives this),
proper labels/ARIA, `prefers-reduced-motion`, hit targets ≥ 40px.

## 11. Deliverables in Module 0
CSS variable token file · Tailwind theme config · shadcn setup + themed variants ·
light/dark switching · a **live `/style` component gallery** page demonstrating every primitive,
pattern, and state.
