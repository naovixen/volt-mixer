# Volt Mixer

A static Astro page that controls a Universal Audio Volt 4 Gen 2's built-in mixer over WebHID,
from Edge or Chrome, with nothing to install. Deployed to GitHub Pages by
`.github/workflows/deploy.yml`. TypeScript, pnpm. `README.md` is for users only (short,
non-technical); the user guide is `src/content/guide` (MDX, served at `/guide/`, see
`DEVELOPMENT.md#the-user-guide`); `DEVELOPMENT.md` is the contributor guide, including adding a new
interface.
`docs/decisions.md` records the choices code cannot explain; `docs/protocol.md` is the
reverse-engineered HID protocol; `docs/maintaining.md` is the update loop for new UA firmware or
software; `docs/performance.md` is how CPU and memory are measured (`tools/perf-bench.mjs`).

## Working rules

Conventions follow `../naovixen` (its `CLAUDE.md` and `.claude/rules/`), with the exceptions in
`docs/decisions.md`. In short:

- **As lean as possible.** Astro (and its MDX integration, for the guide), TypeScript, Vitest and Prettier only (plus Electron,
  electron-builder and node-hid in `desktop/`); no UI or test frameworks beyond that, no jQuery. Ask before
  adding a dependency.
- **Readability over cleverness.** Functions 25 lines, files 400. Comments only where the code
  cannot speak for itself.
- **WCAG 2.2 AA is the floor**, including reflow at 320 CSS px. Browser checks are done by hand
  with the Claude in Chrome extension; there is no end-to-end suite.
- **Hardware safety.** Nothing may raise a level the user didn't move. Monitor level never goes
  below 0 on the wire (the Volt jumps loud). New commands are only sent once captured and
  verified (`docs/maintaining.md`); never probe unknown commands on the hardware.
- **Hands-on steps wait for the user.** Captures that need the user prompt one step at a time and
  wait for them; nothing on a timer. Every capture restores the Volt's settings afterwards and is
  checked with a before/after snapshot.
- **Docs move with the app.** Any change or addition a user can see updates the user guide
  (`src/content/guide`) and its screenshots (`tools/guide-images.mjs`), and the README or privacy
  page where affected, in the same work and before anything is pushed.

## Layout

```
src/
  data/              the protocol as data, per firmware (volt4-gen2.json)
  lib/               pure TypeScript with Vitest tests beside it: protocol encode/decode,
                     mixer model, saved mix, tapers, meters
  lib/engine/        the engine: state, intents, sync and send pump, readings, mix ownership,
                     display fade; runs in the page (website) or the app's main process
  scripts/           browser code: the hosts (web, desktop), WebHID transport, controller,
                     sliders, strips, dialogs
  components/        ui/ (Slider, Meter, Dialog, Icon), mixer/ (strips, outputs, dialogs), site/, guide/
  content/guide/     the user guide, one MDX page each
  layouts/ pages/    BaseLayout and GuideLayout; the mixer page, the tray page, the guide's route
  styles/            tokens (light-dark pairs), reset, base, button, in layers; guide*.css (guide only)
  icons/             SVG icons, with their licences
public/              icon and web app manifest; guide/images (from tools/guide-images.mjs)
tools/               home-PC capture kit, guide screenshots, perf bench (Node 24; imports src/lib). Not deployed.
desktop/             Electron app: the engine in main (node-hid), the site in a window, a tray mixer (own package.json)
reference/decoded/   decoded captures the tests check against (serials redacted)
docs/                protocol, maintenance guide, decisions, performance
```

## Names and style

As naovixen: PascalCase components and types, `I`-prefixed interfaces, camelCase everything
else, `is`/`has` booleans, `on` handlers, arrow functions, kebab-case files. CSS: tokens only,
logical properties, state through ARIA and `data-*`, no `!important`. Tests: `describe("Using X,
when Y")`, `test("then it should …")`, one expectation per test.

## Commits

Conventional Commits. Never commit `captures/`, `reference/ua-api-*.json` or UA's manuals: they
hold the unit's serial number or UA's copyright.
