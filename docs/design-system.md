# Design system — Agency Command Center

The visual language is inherited from sales-ar (a polished cyan command-center). This doc captures the tokens & rules so every contributor stays consistent.

## Tokens (in `src/app/globals.css`)

### Surfaces
- `--background` `#07090F` — deepest navy with cyan/purple radial accent
- `--card` `#111827` — primary card surface (also `cc-card`)
- `--popover` same as card
- `--sidebar` `#0D1117`

### Brand & semantic
- `--color-cyan` `#00D4FF` → primary / brand
- `--color-cc-green` `#10B981` → success
- `--color-amber` `#F59E0B` → warning
- `--color-cc-red` `#EF4444` → destructive
- `--color-cc-blue` `#7da6ff` → info / "in progress"
- `--color-cc-purple` `#8B5CF6` → AI / insights
- `--color-pink` `#EC4899`

Each color has a `-dim` paired token (~14% alpha) for backgrounds.

### Radii
`sm`, `md`, `lg`, `xl`, `2xl`, `3xl`, `4xl` — base `--radius: 1rem`. Use `lg` for cards, `2xl` for large cards / sidebar items, `xl` for dialogs.

### Surface utilities
- `.glass-surface` — translucent navy with cyan rim + inner highlight
- `.cc-card` — solid card with cyan rim + glow
- `.command-grid` — subtle grid for dev/preview backgrounds

### Typography
- `--font-tajawal` set on `html` (Arabic-first)
- Scale used in domain UI: 28/24/20/16/14/12 with Cairo-equivalent weights 400/500/600/700/800

## Components

### Existing primitives (`src/components/ui/`)
shadcn "base-nova" style on `@base-ui/react`: `button`, `input`, `textarea`, `label`, `select`, `dialog`, `dropdown-menu`, `popover`, `avatar`, `card`, `badge`, `separator`, `tabs`, `scroll-area`, `tooltip`, `sheet`, `progress`, `skeleton`, `table`, `alert`, `kpi-card`, `stat-card` (interactive analytics tile), `bar-chart`, `donut-chart`, `line-chart`, `color-badge`, `kpi-indicator`.

### Domain components (`src/components/`)
- `PageHeader` — page-level title with description + breadcrumbs + actions
- `MetricCard` — dashboard headline tile with tone, optional href, optional trend
- `EmptyState` — bordered dashed card with icon, title, description, action
- `ErrorState` — destructive variant with optional `onRetry`
- `SectionTitle` — `<h2>` with description and right-side actions slot
- `Skeletons` (`PageHeaderSkeleton`, `StatRowSkeleton`, `CardListSkeleton`, `TableSkeleton`) — drop-in loading patterns
- `Kbd` — keyboard key chip
- `FilterBar` — search input + filter slot + "clear" button
- `DataTableShell` + `DataTable*` — RTL-aware table primitives with cyan rim
- `CommandPaletteProvider` + `CommandPaletteTrigger` — Cmd-K palette stub (Phase-3 wires in actions)
- Status badges (`status-badges.tsx`): `TaskStatusBadge`, `PriorityBadge`, `ProjectStatusBadge`, `HandoverStatusBadge`, `ClientStatusBadge`, `UrgencyBadge`, `EmploymentStatusBadge`, `ServiceBadge`

## Rules

1. **Every page** must have skeleton + empty + error states.
2. **Every list** uses `EmptyState` with a primary CTA when zero.
3. **Mutations** show a sonner toast: `toast.success` on success, `toast.error` on failure.
4. **Dates** rendered with `Intl.DateTimeFormat("ar-SA", …)`. Numbers via `tabular-nums`.
5. **Buttons**: primary action = default cyan; destructive only for irreversible actions; secondary for "less weight" cancels.
6. **RTL**: layouts use logical properties (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`). Directional icons get `icon-flip-rtl`.
7. **Mobile**: tables degrade to cards below `md`. Sidebar becomes a drawer below `lg`.
8. **Cmd-K** is the canonical entry point for power users. Every new module must register at least one command in Phase 3+.

## Showcase

Run `bun dev` and visit `http://localhost:3000/dev/design-system` (public, no auth required). Every primitive and state should render correctly there. Use this page as the regression check for any visual change.

## Don't
- Don't introduce new color hexes inline. Use the palette tokens.
- Don't use radix imports — this codebase is on `@base-ui/react`.
- Don't write bare `<table>` styles — use `DataTableShell`.
- Don't hardcode Arabic strings in pages unless they're page-specific copy. Reuse `lib/copy.ts` and `lib/labels.ts`.
