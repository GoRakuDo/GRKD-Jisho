# GRKD-Jisho Web Admin — Design Reference
> Quiet operations console for a Discord dictionary bot — simple, minimal, precise, with royal blue used only for primary action and focus. Modern like Tesla/SpaceX product surfaces, but without overhyped futuristic decoration.

**Theme:** light-first admin UI with restrained dark surfaces

GRKD-Jisho Web Admin should feel like a calm control room, not a sci-fi dashboard. The interface is for reviewing generated dictionary answers, editing manual overrides, reading traces, and approving ops jobs. It must help administrators make safe decisions quickly.

The visual system is minimal: soft graphite text, warm off-white surfaces, fine borders, compact spacing, and one chromatic accent — royal blue. Royal blue is reserved for primary buttons, active navigation, selected rows, focus rings, and main highlights. Do not scatter blue across decorative shapes. This UI should look engineered, quiet, and trustworthy.

Pure black and pure white are forbidden. Every color token uses OKLCH.

---

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Graphite 900 | `oklch(20% 0.018 255)` | `--color-graphite-900` | Primary text, strongest borders, dark surface text inversion base. Not pure black. |
| Graphite 800 | `oklch(27% 0.018 255)` | `--color-graphite-800` | Headings, high-emphasis labels, active sidebar text. |
| Graphite 650 | `oklch(43% 0.016 255)` | `--color-graphite-650` | Secondary body text, descriptions, helper copy. |
| Graphite 500 | `oklch(57% 0.014 255)` | `--color-graphite-500` | Muted metadata, timestamps, placeholder text. |
| Graphite 300 | `oklch(78% 0.012 255)` | `--color-graphite-300` | Neutral borders, dividers, disabled border lines. |
| Graphite 180 | `oklch(90% 0.008 255)` | `--color-graphite-180` | Subtle table row separators and low-contrast strokes. |
| Porcelain 50 | `oklch(97% 0.012 95)` | `--color-porcelain-50` | Page background. Warm off-white, never pure white. |
| Porcelain 100 | `oklch(94.5% 0.014 95)` | `--color-porcelain-100` | Primary card background and top bar surface. |
| Porcelain 150 | `oklch(91.5% 0.016 95)` | `--color-porcelain-150` | Secondary panels, table header rows, hover surfaces. |
| Porcelain 220 | `oklch(86.5% 0.018 95)` | `--color-porcelain-220` | Pressed neutral controls, disabled fills. |
| Royal Blue 600 | `oklch(50% 0.19 262)` | `--color-royal-blue-600` | Primary buttons, active nav indicator, selected state, main focus ring. |
| Royal Blue 700 | `oklch(43% 0.19 262)` | `--color-royal-blue-700` | Primary hover and pressed states. |
| Royal Blue 100 | `oklch(92% 0.045 262)` | `--color-royal-blue-100` | Selected row background, subtle highlight, active sidebar wash. |
| Royal Blue 50 | `oklch(96% 0.025 262)` | `--color-royal-blue-50` | Very soft blue surface for informational callouts. |
| Success 600 | `oklch(54% 0.12 155)` | `--color-success-600` | Success state, approved jobs, enabled dictionary state. |
| Success 100 | `oklch(93% 0.04 155)` | `--color-success-100` | Success badge background. |
| Warning 600 | `oklch(64% 0.14 78)` | `--color-warning-600` | Pending state, caution labels. |
| Warning 100 | `oklch(94% 0.055 78)` | `--color-warning-100` | Warning badge background. |
| Danger 600 | `oklch(55% 0.18 28)` | `--color-danger-600` | Reject, failed, destructive warning text. |
| Danger 100 | `oklch(93% 0.055 28)` | `--color-danger-100` | Dangerous action warning background. |
| Trace Violet 600 | `oklch(52% 0.15 305)` | `--color-trace-violet-600` | Trace-specific accent for timeline nodes only. Use sparingly. |

### Color Rules

- Use royal blue for main actions and selection only.
- Do not use pure black or pure white anywhere, even as fallback values.
- Do not use neon colors, saturated gradients, glassmorphism, cyberpunk purple, or glowing UI.
- Use state colors only when state is meaningful: success, warning, danger, trace.
- Prefer border and surface contrast over shadow.

---

## Tokens — Typography

### GRKD Sans — UI, body, navigation, tables, forms · `--font-grkd-sans`

- **Substitute:** Inter, Geist, IBM Plex Sans, system-ui
- **Weights:** 400, 500, 600, 700
- **Sizes:** 12px, 13px, 14px, 16px, 20px, 28px, 40px
- **Line height:** 1.15–1.55
- **Letter spacing:** -0.02em at display sizes, -0.01em at headings, normal for tables
- **Role:** The main interface typeface. It should feel engineered and readable, not editorial.

### GRKD Mono — IDs, trace IDs, model names, JSON, metadata · `--font-grkd-mono`

- **Substitute:** JetBrains Mono, IBM Plex Mono, SFMono-Regular, ui-monospace
- **Weights:** 400, 500
- **Sizes:** 11px, 12px, 13px, 14px
- **Line height:** 1.35–1.55
- **Letter spacing:** normal
- **Role:** Technical data. Use for `trace_id`, `response_cache.id`, `model_name`, `prompt_version`, timestamps, and redacted payloads.

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| caption | 12px | 1.35 | 0 | `--text-caption` |
| label | 13px | 1.35 | 0.01em | `--text-label` |
| body-sm | 14px | 1.5 | 0 | `--text-body-sm` |
| body | 16px | 1.55 | 0 | `--text-body` |
| heading-sm | 20px | 1.3 | -0.01em | `--text-heading-sm` |
| heading | 28px | 1.2 | -0.015em | `--text-heading` |
| display | 40px | 1.12 | -0.02em | `--text-display` |

---

## Tokens — Spacing & Shapes

**Base unit:** 4px

**Density:** compact but breathable

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 20 | 20px | `--spacing-20` |
| 24 | 24px | `--spacing-24` |
| 32 | 32px | `--spacing-32` |
| 48 | 48px | `--spacing-48` |
| 64 | 64px | `--spacing-64` |

### Border Radius

| Element | Value |
|---------|-------|
| buttons | 10px |
| inputs | 10px |
| small badges | 999px |
| cards | 16px |
| panels | 20px |
| modals | 24px |
| code blocks | 12px |

### Layout

- **App shell width:** full viewport
- **Main content max-width:** 1440px
- **Sidebar width:** 248px
- **Top bar height:** 64px
- **Page padding:** 24px desktop, 16px tablet/mobile
- **Section gap:** 24px–32px
- **Card padding:** 20px–24px
- **Table row height:** 48px minimum

---

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Page Base | `oklch(97% 0.012 95)` | Root background. Warm porcelain, never white. |
| 1 | App Surface | `oklch(94.5% 0.014 95)` | Sidebar, top bar, primary cards. |
| 2 | Panel Surface | `oklch(91.5% 0.016 95)` | Table headers, filter bars, grouped controls. |
| 3 | Pressed Neutral | `oklch(86.5% 0.018 95)` | Pressed neutral controls and disabled fills. |
| 4 | Graphite Inversion | `oklch(20% 0.018 255)` | Rare dark cards for trace or ops emphasis, never pure black. |
| Accent | Royal Blue Wash | `oklch(96% 0.025 262)` | Soft selected and information states. |

## Elevation

Use almost no shadow.

Depth comes from surfaces and borders:

- Default cards: `1px solid oklch(78% 0.012 255 / 0.55)`
- Floating menus: subtle shadow only, max `0 16px 40px oklch(20% 0.018 255 / 0.10)`
- No heavy drop shadows.
- No glowing borders.
- No glass blur panels.

---

## Components

### App Shell
**Role:** Persistent admin frame for all pages

Two-column layout. Left sidebar is fixed at 248px on desktop with `Porcelain 100` surface and a right border. Main area uses `Porcelain 50`. Top bar is 64px high with page title, environment badge, health indicator, and user menu. The shell should feel like an operations console: stable, quiet, predictable.

### Sidebar Navigation
**Role:** Main admin navigation

Items: Dashboard, Responses, Dictionaries, Cache, Logs, Traces, Ops Jobs.

Default item uses transparent background, Graphite 650 text, 10px radius. Active item uses Royal Blue 100 background, Royal Blue 700 text, and a 3px royal-blue left rail. Hover uses Porcelain 150. No icons unless needed; if icons exist, use thin 1.75px stroke and no filled illustrations.

### Top Bar
**Role:** Current page context and status

Background `Porcelain 100`, bottom border `Graphite 180`. Left side shows the current section title. Right side shows DB/Bot/MCP/Web health chips, then Discord user menu. Health chips use state colors but stay small.

### Primary Button
**Role:** Main action on a screen

Background `Royal Blue 600`, text `Porcelain 50`, border `1px solid Royal Blue 700`, radius 10px, padding 10px 16px. Font 14px, weight 600. Hover background `Royal Blue 700`. Focus ring `0 0 0 3px Royal Blue 100`.

Use for: Save response, Approve job, Apply filter, Import dictionary confirmation.

### Secondary Button
**Role:** Safe secondary action

Background `Porcelain 100`, text `Graphite 800`, border `1px solid Graphite 300`, radius 10px, padding 10px 16px. Hover background `Porcelain 150`. No blue unless focused.

Use for: Cancel, Back, Preview, Clear filters.

### Danger Button
**Role:** Destructive or rejecting action

Background `Danger 100`, text `Danger 600`, border `1px solid oklch(72% 0.12 28)`, radius 10px. Hover should deepen background slightly, not become bright red.

Use for: Reject job, Delete non-manual cache, Disable dictionary.

### Input Field
**Role:** Text entry and filters

Background `Porcelain 50`, text `Graphite 900`, border `1px solid Graphite 300`, radius 10px, height 40px, padding 0 12px. Placeholder `Graphite 500`. Focus border `Royal Blue 600`, focus ring `Royal Blue 100`. No pure white fill.

### Select / Filter Bar
**Role:** Query, role, state, date filters

Filter bars use `Panel Surface`, radius 16px, border `Graphite 180`, padding 12px. Inputs sit in a single row on desktop and wrap on smaller widths. Apply button is royal blue; reset is secondary.

### Data Table
**Role:** Dense admin lists

Table container uses `App Surface`, radius 16px, border `Graphite 180`, overflow hidden. Header row uses `Panel Surface`, 12px uppercase labels, Graphite 500. Body rows use 14px text and 48px minimum height. Hover row uses `Porcelain 150`. Selected row uses `Royal Blue 50` with a royal-blue left rail. No zebra stripes unless data density becomes too high.

### Response Card / Editor
**Role:** Manual response review and editing

Two-column desktop layout. Left: metadata and source info. Right: editable answer text. The text area uses `Porcelain 50`, Graphite 900, 14–16px body, 1.55 line height. Manual override status is a small royal-blue badge only when true. Save button is royal blue. History timeline sits below with compact entries.

### Status Badge
**Role:** Small state label

Badges use pill radius, 12px font, medium weight, padding 4px 8px. They are not decorative.

Status mapping:

| Status | Background | Text |
|---|---|---|
| manual override | Royal Blue 100 | Royal Blue 700 |
| enabled / approved / succeeded | Success 100 | Success 600 |
| pending / running | Warning 100 | Warning 600 |
| failed / rejected / dangerous | Danger 100 | Danger 600 |
| read-only / dry-run | Porcelain 150 | Graphite 650 |

### Trace Timeline
**Role:** Visualize one `trace_id`

Timeline uses a vertical line in Graphite 300. Each event is a row with timestamp, event type, level, duration, and redacted payload. Error events use Danger 600. Warning events use Warning 600. Normal events use Graphite 650. Trace-specific markers may use Trace Violet 600, but only as a small dot or line segment.

No animated neon traces. This is a log viewer, not a spaceship HUD.

### Ops Job Panel
**Role:** Human approval for agent-created jobs

Pending jobs use a clear warning surface, not an alarming red surface. The action area must separate Approve and Reject. Approve is Primary Button. Reject is Danger Button. Args JSON appears in mono text inside a subdued code block. Dangerous jobs must show a short reason and final confirmation.

### Code / JSON Block
**Role:** Show payloads and redacted args

Background `Graphite 900`, text `Porcelain 150`, border radius 12px, padding 16px. Mono 13px, line height 1.5. Keys can use Graphite 300. Redacted values use Warning 100 text on Graphite surface. Do not use pure black.

### Empty State
**Role:** No data state

Use a quiet card with a short title and one sentence. No mascot, no illustration. Example: “No pending ops jobs. Agent requests that need approval will appear here.” Secondary action only if useful.

---

## Page Patterns

### Dashboard

Top row: 4 compact metric cards — lookups today, cache hit ratio, pending ops jobs, recent errors. Below: two columns with recent traces and system health. Royal blue only highlights the primary metric or active link.

### Auth / Login

**Purpose:** TOTP setup and verification page.

**Layout:** Two-column split on desktop: left branding panel (guide cards), right auth surface (QR + form). Column ratio is `0.68fr / 1.32fr` — right side gets more space for the QR block and code input.

**Rules:**
- QR block max-width is **360px**. This is enough for scanning, and prevents the right panel from overflowing the viewport.
- The right auth surface is a **single card** (no nested panel + card split). QR, manual secret, and form sit in one vertical flow inside it.
- Guide cards on the left use 2 columns (3rd card spans both).
- The form must be wide enough so the "Verify & Complete Setup" button text does not wrap to 2 lines. On desktop, use `max-w-[560px]` for the form.
- The form button should not be taller than needed. Use compact padding (`py-3` not `py-4`).
- If the combined right panel exceeds the viewport height, shrink QR size and form gaps before changing the layout structure.

**States:**
- **Unconfigured (setupRequired=true):** Show QR code image, manual secret key, and code input form stacked vertically in the right card.
- **Configured (verified):** Show only the code input form. No QR section.

**Edge cases:**
- If the QR is so large it pushes the form below the viewport, reduce QR container width (down to 320px) or reduce padding.
- Never hide the form behind scroll just to keep a large QR.

### Dictionaries

Priority list should feel mechanical and safe. Enabled toggle uses success state when on, neutral when off. Import flow is preview-first. No drag animation fireworks. If drag-and-drop is implemented, use a simple outline and reorder handle.

### Cache

Refresh is dangerous enough to require preview. Show matching count, manual override count, deletable count. The execute button remains royal blue only after preview. Deletion warnings use Danger 100, not bright red.

### Logs

Charts must be simple. Use thin lines, muted axes, and royal blue for the main series. Avoid rainbow charts. If multiple categories are needed, use Graphite + royal blue + one state color at most.

### Traces

Search by trace ID. Show summary first, timeline second, payload third. Errors should be easy to spot. Keep JSON collapsed by default if long.

### Ops Jobs

Pending approvals are the main focus. Approved/running/succeeded/failed/rejected are secondary tabs. The page must make it obvious that Web approves jobs; Bot executes them.

---

## Do's and Don'ts

### Do

- Use OKLCH color tokens only.
- Use royal blue for primary actions, active state, selection, and focus.
- Use warm off-white surfaces instead of pure white.
- Use soft graphite instead of pure black.
- Keep UI flat, bordered, and calm.
- Make dangerous actions require preview or confirmation.
- Make trace IDs, cache IDs, model names, and prompt versions mono.
- Keep tables dense but readable.
- Use copy that explains consequences plainly.
- **Prioritize spacious layouts over packing everything in. No visible compression.**
- **Keep content within the viewport. If it overflows vertically, shrink elements — don't change layout strategy.**
- **Adjust sizes carefully (width, padding, margin, font) before changing column structure.**

### Don't

- Do not use pure white or pure black.
- Do not use neon gradients, glow effects, holographic panels, glassmorphism, or overhyped futuristic styling.
- Do not use royal blue as random decoration.
- Do not use multiple bright accent colors in one section.
- Do not hide dangerous actions behind ambiguous labels.
- Do not use emoji as UI decoration.
- Do not use large hero marketing sections inside the admin app.
- Do not use heavy shadows or floating cards everywhere.
- Do not make the UI look like a crypto dashboard or sci-fi cockpit.

---

## Accessibility

- All text/background pairs must target WCAG AA contrast at minimum.
- Focus states must be visible and royal-blue based.
- Buttons need clear text labels, not icon-only actions unless paired with accessible labels.
- Tables need readable row height and hover/focus states.
- State must not rely on color alone. Use text labels like `pending`, `failed`, `manual`.
- Motion should be minimal and respect `prefers-reduced-motion`.

---

## Imagery

Use no decorative imagery by default.

If a visual is needed, use simple geometric line diagrams or product-style schematics in Graphite and Royal Blue. Avoid spacecraft, neon grids, AI brains, glowing orbs, robots, or cyberpunk motifs. This is a dictionary operations UI, not a launch trailer.

---

## Agent Prompt Guide

**Quick Color Reference**

- Page background: `oklch(97% 0.012 95)`
- Primary text: `oklch(20% 0.018 255)`
- Card surface: `oklch(94.5% 0.014 95)`
- Panel surface: `oklch(91.5% 0.016 95)`
- Primary action: `oklch(50% 0.19 262)` royal blue
- Primary hover: `oklch(43% 0.19 262)`
- Selection wash: `oklch(96% 0.025 262)`
- Danger: `oklch(55% 0.18 28)`
- Success: `oklch(54% 0.12 155)`
- Warning: `oklch(64% 0.14 78)`

**Example Component Prompts**

1. **Admin Shell:** Warm porcelain OKLCH page background, fixed 248px left sidebar, 64px top bar, thin graphite borders, no heavy shadows. Active sidebar item uses soft royal-blue wash and a 3px royal-blue left rail.

2. **Primary Action Button:** Royal blue OKLCH background `oklch(50% 0.19 262)`, warm off-white text `oklch(97% 0.012 95)`, 10px radius, 1px darker royal-blue border, compact 10px 16px padding, no glow.

3. **Response Table:** Rounded 16px card surface in `oklch(94.5% 0.014 95)`, table header `oklch(91.5% 0.016 95)`, 48px rows, graphite text, selected row uses `oklch(96% 0.025 262)` and royal-blue left rail.

4. **Trace Timeline:** Vertical graphite line, compact event rows, mono trace metadata, error rows in muted danger OKLCH, no neon timeline effects, JSON collapsed by default.

5. **Ops Approval Card:** Pending job card with warning wash, redacted args JSON in dark graphite code block, Approve button in royal blue, Reject button in muted danger, clear consequence copy.

---

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Colors — OKLCH only */
  --color-graphite-900: oklch(20% 0.018 255);
  --color-graphite-800: oklch(27% 0.018 255);
  --color-graphite-650: oklch(43% 0.016 255);
  --color-graphite-500: oklch(57% 0.014 255);
  --color-graphite-300: oklch(78% 0.012 255);
  --color-graphite-180: oklch(90% 0.008 255);

  --color-porcelain-50: oklch(97% 0.012 95);
  --color-porcelain-100: oklch(94.5% 0.014 95);
  --color-porcelain-150: oklch(91.5% 0.016 95);
  --color-porcelain-220: oklch(86.5% 0.018 95);

  --color-royal-blue-600: oklch(50% 0.19 262);
  --color-royal-blue-700: oklch(43% 0.19 262);
  --color-royal-blue-100: oklch(92% 0.045 262);
  --color-royal-blue-50: oklch(96% 0.025 262);

  --color-success-600: oklch(54% 0.12 155);
  --color-success-100: oklch(93% 0.04 155);
  --color-warning-600: oklch(64% 0.14 78);
  --color-warning-100: oklch(94% 0.055 78);
  --color-danger-600: oklch(55% 0.18 28);
  --color-danger-100: oklch(93% 0.055 28);
  --color-trace-violet-600: oklch(52% 0.15 305);

  /* Typography */
  --font-grkd-sans: Inter, Geist, "IBM Plex Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-grkd-mono: "JetBrains Mono", "IBM Plex Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  --text-caption: 12px;
  --text-label: 13px;
  --text-body-sm: 14px;
  --text-body: 16px;
  --text-heading-sm: 20px;
  --text-heading: 28px;
  --text-display: 40px;

  --leading-caption: 1.35;
  --leading-body: 1.55;
  --leading-heading: 1.2;
  --tracking-heading: -0.015em;
  --tracking-display: -0.02em;

  /* Spacing */
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-48: 48px;
  --spacing-64: 64px;

  /* Radii */
  --radius-button: 10px;
  --radius-input: 10px;
  --radius-card: 16px;
  --radius-panel: 20px;
  --radius-modal: 24px;
  --radius-pill: 999px;
}
```

### Tailwind v4 Theme

```css
@theme {
  --color-graphite-900: oklch(20% 0.018 255);
  --color-graphite-800: oklch(27% 0.018 255);
  --color-graphite-650: oklch(43% 0.016 255);
  --color-graphite-500: oklch(57% 0.014 255);
  --color-graphite-300: oklch(78% 0.012 255);
  --color-graphite-180: oklch(90% 0.008 255);

  --color-porcelain-50: oklch(97% 0.012 95);
  --color-porcelain-100: oklch(94.5% 0.014 95);
  --color-porcelain-150: oklch(91.5% 0.016 95);
  --color-porcelain-220: oklch(86.5% 0.018 95);

  --color-royal-blue-600: oklch(50% 0.19 262);
  --color-royal-blue-700: oklch(43% 0.19 262);
  --color-royal-blue-100: oklch(92% 0.045 262);
  --color-royal-blue-50: oklch(96% 0.025 262);

  --color-success-600: oklch(54% 0.12 155);
  --color-success-100: oklch(93% 0.04 155);
  --color-warning-600: oklch(64% 0.14 78);
  --color-warning-100: oklch(94% 0.055 78);
  --color-danger-600: oklch(55% 0.18 28);
  --color-danger-100: oklch(93% 0.055 28);
  --color-trace-violet-600: oklch(52% 0.15 305);

  --font-grkd-sans: Inter, Geist, "IBM Plex Sans", system-ui, sans-serif;
  --font-grkd-mono: "JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace;

  --radius-button: 10px;
  --radius-input: 10px;
  --radius-card: 16px;
  --radius-panel: 20px;
  --radius-modal: 24px;
}
```

---

## Similar Direction

- **Tesla account / product UI** — calm product minimalism, large negative space, precise controls.
- **SpaceX operational pages** — restrained technical tone, not decorative futurism.
- **Linear** — compact admin workflows, subtle borders, clear active states.
- **Vercel dashboard** — clean layout and controlled density, but GRKD-Jisho should use warmer surfaces and royal blue instead of stark black/white.
- **Stripe dashboard** — strong tables and forms, but with fewer gradients and less marketing polish.
