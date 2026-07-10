---
name: nais2-ui-quality
description: This skill should be used when the user asks to "improve NAIS2 UI", "fix NAIS2 mobile layout", "audit responsive screens", "change NAIS2 design tokens", or "run visual QA" in this repository.
version: 0.1.0
---

# NAIS2 UI Quality

Apply the repository's Cobalt Instrument design system without weakening generation behavior, Android stability, or platform gates.

## Required context

1. Read `DESIGN.md` completely before introducing visual values.
2. Read `docs/nais2-mobile-release-sync-checklist.md` when touching shell, storage, updater, sidecar, shortcut, or Android behavior.
3. Read the latest `.superloopy/evidence/frontend/*/VISUAL_QA.md` when one exists.
4. Inspect the affected component and its parent layout before editing.

## Workflow

1. Audit the current UI in Chromium at 390, 768, and 1280 px.
2. Record the intended change in `DESIGN.md` first when it adds a token, breakpoint, interaction, or reusable component rule.
3. Preserve store actions, cancellation/session behavior, Tauri storage adapters, and `isMobileRuntime` or capability gates.
4. Use semantic OKLCH-backed Tailwind tokens. Avoid raw hue utilities, glass blur, decorative gradients, nested cards, and page-level horizontal scrolling.
5. Keep primary touch controls at least 44 by 44 px and bind mobile overlays to safe-area insets.
6. Keep all actions reachable. Move secondary actions into a named overflow menu rather than removing them.
7. Add or update deterministic layout assertions when fixing an overflow or touch-target regression.
8. Run the verification ladder and inspect screenshots before reporting completion.

## Verification ladder

Run in this order:

```text
npm run lint
npm run build
npm run test:responsive-layout
npm run test:android-port
```

To generate review screenshots while running the responsive contract, set `RESPONSIVE_EVIDENCE_DIR` to the target evidence directory before `npm run test:responsive-layout`.

## Evidence contract

Write final evidence under `.superloopy/evidence/frontend/<session>/`:

- `TARGET_SPEC.md` for the chosen direction and acceptance deltas
- `VISUAL_QA.md` for viewport-by-viewport findings and corrections
- 390/768/1280 screenshots for the affected routes
- `PERF.md` when Lighthouse or equivalent performance evidence is collected

Report device validation separately from browser emulation. Never claim physical Android verification without a real device run.

## Specialist routing

Delegate read-only responsive verification to `.codex/agents/nais2-ui-verifier.toml` when parallel browser evidence materially reduces the implementation loop. Keep source ownership with the implementing agent.
