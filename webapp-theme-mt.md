# MT Theme Spec

Mandatory theme source for MT-vibe webapps. Tokens are law; vibe is direction.

## Exact Values

```css
:root {
  --bg-deep: #08080c; --bg: #0c0c12; --bg-raised: #13131a; --bg-card: #16161f;
  --bg-hover: #1c1c28; --bg-input: #0e0e16; --border: #1e1e2c; --border-subtle: #151520;
  --text: #f0f0f5; --text-secondary: #9090a8; --text-muted: #50506a; --text-dim: #3a3a52;
  --blue: #4f8eff; --blue-glow: rgba(79,142,255,0.15); --blue-soft: rgba(79,142,255,0.08);
  --indigo: #7c5cff; --indigo-glow: rgba(124,92,255,0.15); --violet: #b06cff;
  --violet-glow: rgba(176,108,255,0.12); --emerald: #34d399; --emerald-glow: rgba(52,211,153,0.12);
  --emerald-soft: rgba(52,211,153,0.08); --amber: #fbbf24; --amber-glow: rgba(251,191,36,0.12);
  --rose: #fb7185; --rose-glow: rgba(251,113,133,0.12); --rose-soft: rgba(251,113,133,0.08);
  --cyan: #22d3ee; --cyan-glow: rgba(34,211,238,0.12); --orange: #f97316;
  --success: var(--emerald); --error: var(--rose); --warning: var(--amber);
  --r: 14px; --r-sm: 10px; --r-xs: 7px; --r-pill: 100px;
  --font: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
}
```

```xml
<resources>
  <color name="primary">#FF1A1A2E</color>
  <color name="primary_dark">#FF0F0F23</color>
  <color name="accent">#FF6C63FF</color>
  <color name="accent_light">#FF8B83FF</color>
  <color name="surface">#FF16213E</color>
  <color name="surface_light">#FF1E2D50</color>
  <color name="on_surface">#FFE8E8E8</color>
  <color name="on_surface_secondary">#FF9BA3B5</color>
  <color name="success">#FF00D2FF</color>
  <color name="warning">#FFFF6B6B</color>
  <color name="error">#FFFF4757</color>
  <color name="splash_bg">#FF0F0F23</color>
</resources>
```

- `primary` → deep background/dark surfaces
- `primary_dark` → system bars (status + navigation)
- `accent` → primary action color
- `accent_light` → hover states, soft glows
- `surface` → raised backgrounds
- `surface_light` → card backgrounds
- `on_surface` → primary text
- `on_surface_secondary` → secondary text
- `success` → success signals
- `warning` → warning signals
- `error` → error signals
- `splash_bg` → splash screen background

Host chrome (observed MT values): system bars `#0A0A1A`, WebView pre-paint `#0B0E14`, layout background `#0A0A1A`, error fallback page background `#0B0E14` with text `#F2EFE6`.

## Vibe

- **Mood:** deep, immersive, nocturnal — a quiet, focused workspace, never a bright day UI.
- **Surface layering:** depth through color hierarchy (bg-deep → bg → bg-raised → bg-card); elevation shown with soft glows and subtle borders, not shadows.
- **Accent/glow usage:** neon-like accents (blue, indigo, violet, emerald, amber, rose, cyan) paired with low-opacity glows and soft fills for interactive states, not solid blocks.
- **Shape language:** rounded corners everywhere (14px default, 10px small, 7px extra-small, 100px pill) across cards, chips, buttons, inputs.
- **Typography:** Inter for UI text, JetBrains Mono (or system fallbacks) for code/mono; hierarchy via text → secondary → muted → dim.
- **Structuring patterns:** single-activity fullscreen WebView host, hidden status/nav bars (swipe to reveal), edge-to-edge dark surfaces, card-based content UI, pill chips, bottom sheets, toasts, top-bar navigation, dark splash screen.

## Usage

When briefing `ui-designer` with this file, treat the tokens as exact law — never override a hex value. Use the vibe section for design direction and interaction patterns. The builder must attach this file as the mandatory theme source and require the UI to reference both the token values and the vibe for layout, spacing, motion, affordances, and responsive behavior.
