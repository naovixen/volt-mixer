# Developing Volt Mixer

This guide is for anyone who wants to change Volt Mixer, or add support for another audio
interface and send it back as a pull request. It assumes no prior experience with this project and
explains each step. You can follow it on your own, or open the repository in an AI coding agent
(such as Claude Code) and work through it together: the agent can run the commands, read the
output and write the code, while you handle anything physical.

If you only want to use Volt Mixer, the [README](README.md) and the
[guide](https://naovixen.github.io/volt-mixer/guide/) are all you need.

- [How it works](#how-it-works)
- [Set up your computer](#set-up-your-computer)
- [Run it locally](#run-it-locally)
- [Project layout](#project-layout)
- [The user guide](#the-user-guide)
- [Ground rules](#ground-rules)
- [Add your audio interface](#add-your-audio-interface)
- [Open a pull request](#open-a-pull-request)
- [Platform notes](#platform-notes)
- [Releases](#releases)

## How it works

Volt Mixer is a static website built with [Astro](https://astro.build) and TypeScript. It talks to
the Volt directly over USB using **WebHID**, a browser feature only Chromium browsers (Edge,
Chrome) have. There is no server: everything runs in the page.

UA doesn't publish the Volt's USB protocol. It was worked out by recording the USB traffic while
UAD Console changed each setting, then decoding which bytes changed. The result is written down in
three places:

| Where                                | What                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------- |
| [docs/protocol.md](docs/protocol.md) | The protocol in words: every command, report and byte the page uses.        |
| `src/data/volt4-gen2.json`           | The same protocol as data, per firmware version, which the code reads.      |
| `reference/decoded/`                 | Decoded recordings. The tests re-encode every one to prove the code agrees. |

Everything between the Volt and the screen is the **engine** (`src/lib/engine`): the state, every
change, what's sent and when, the readings, and this computer's mix. It has no DOM, so it runs in
two places. On the website it runs in the page, with WebHID and the browser's storage
(`src/scripts/host-web.ts`). The desktop app (`desktop/`) is [Electron](https://www.electronjs.org):
there the engine runs in the app's main process, with node-hid and a file
(`desktop/src/engine-host.ts`). The same site in a window shows it (`src/scripts/host-desktop.ts`),
plus a tray mixer and a phone remote. The views only read the engine's snapshot and send it changes.

Other useful reading:

- [docs/decisions.md](docs/decisions.md): why things are the way they are.
- [docs/maintaining.md](docs/maintaining.md): what to do when UA ships new firmware or software,
  and the full list of capture tools.
- [docs/remote-sync.md](docs/remote-sync.md): how the phone remote and mix links work.
- [CLAUDE.md](CLAUDE.md): the working rules, written for AI agents but useful for people too.

## Set up your computer

You need:

1. **Git**: [git-scm.com](https://git-scm.com/downloads). On Windows, the installer's defaults are
   fine.
2. **Node.js 24**: [nodejs.org](https://nodejs.org). Pick the version 24 installer (the repository's
   `.nvmrc` says 24).
3. **pnpm**, the package manager this project uses. After installing Node, open a terminal and run:

    ```sh
    corepack enable
    ```

    Corepack comes with Node and installs the exact pnpm version named in `package.json`.

4. **A GitHub account**, to fork the repository and open a pull request. The
   [GitHub CLI](https://cli.github.com) (`gh`) makes the pull request step easier but isn't required.

Then get the code. On GitHub, choose **Fork** on
[naovixen/volt-mixer](https://github.com/naovixen/volt-mixer) to make your own copy, then:

```sh
git clone https://github.com/<your-username>/volt-mixer.git
cd volt-mixer
pnpm install
```

## Run it locally

```sh
pnpm dev       # the site at http://localhost:4321/volt-mixer/, reloading as you edit
pnpm test      # unit tests, capture re-encoding and colour-contrast checks
pnpm lint      # type checks (astro check) and formatting (prettier)
pnpm format    # fixes formatting
pnpm build     # the production site, into dist/
pnpm preview   # serves dist/ (more reliable than dev for checking styles)
```

The desktop app has its own packages:

```sh
cd desktop
pnpm install
pnpm start     # builds the site into desktop/site and runs the app
pnpm typecheck # type checks the app's own code (its tests run with the site's, in pnpm test)
pnpm dist      # installers for this system, into desktop/release
```

Close UAD Console and the installed Volt Mixer app while you test: two programs controlling one
Volt disagree with each other.

To measure CPU and memory, `tools/perf-bench.mjs` runs the built site and app against a fake Volt
(it never reaches a real one) and prints a table. [docs/performance.md](docs/performance.md) has
the method and the numbers to compare against. Run it before and after a change that could cost
time: anything on the meter, drag or send path.

## Project layout

```
src/
  data/              the protocol as data, per firmware (volt4-gen2.json); the guide's
                     screenshot sizes (guide-images.json, written by tools/guide-images.mjs)
  content/guide/     the user guide, one MDX file per page
  lib/               pure TypeScript with Vitest tests beside it: protocol encode/decode,
                     mixer model, saved mix, tapers, meters
  lib/engine/        the engine: state, intents, sync and send pump, readings, mix ownership,
                     display fade; runs in the page (website) or the app's main process
  scripts/           browser code: the hosts (web, desktop), WebHID transport, controller,
                     sliders, strips, dialogs
  components/        ui/ (Slider, Meter, Dialog, Icon), mixer/ (strips, outputs, dialogs), site/, guide/
  layouts/ pages/    BaseLayout and GuideLayout; the mixer page and the desktop app's tray page;
                     pages/_website: what only the website has (the guide's pages and search
                     index, privacy, the sitemap)
  styles/            tokens (light-dark pairs), reset, base, and the shared button, switch,
                     message, text, tone and choice styles; guide*.css for the guide only
  icons/             SVG icons, with their licences
public/              icon and web app manifest; guide/images, the guide's screenshots
tools/               capture kit for a Windows PC with UAD Console (Node 24), the guide's
                     screenshot tool and the performance bench (perf-bench.mjs). Not deployed.
desktop/             Electron app: the engine in main (node-hid), the site in a window, a tray mixer (own package.json)
reference/decoded/   decoded captures the tests check against (serial numbers removed)
docs/                protocol, maintenance guide, decisions, performance
```

## The user guide

The guide at `/guide/` is for people using Volt Mixer. Each page is an MDX file (Markdown that
can use components) in `src/content/guide`, shown by `src/pages/_website/guide/[...slug].astro`
with `src/layouts/GuideLayout.astro`.

**Any change a user can see updates the guide, and its screenshots, before it's pushed.**

- **Add a page:** write `src/content/guide/<slug>.mdx` with the same front matter as the others:
  `title`, `description`, `lead`, its sidebar `group` (one of `guideGroupTitles` in
  `src/lib/guide-nav.ts`) and its `order` in that group, plus `navTitle` if the sidebar should
  call it something shorter. That places it in the sidebar, the previous and next links, the
  search index and the sitemap. The build fails if two pages claim one place.
- **Write for scanning:** short paragraphs, numbered lists for steps, a table where one thing
  maps to another, and side-by-side lists where two things are compared.
- **Components** (`src/components/guide`) need no imports: they're passed to every page from
  `guideComponents` in `src/pages/_website/guide/_entries.ts`. A new one is a component there and
  a line in that map. Markdown tables and numbered lists are drawn by `Table.astro` and
  `NumberedList.astro` from the same map.
    - `<Shot name="strip" alt="…" />`: a screenshot in light and dark, sized automatically.
    - `<Parts>`: wraps a numbered list that keys a screenshot's numbers. Start each item with the
      part's name in bold, then its explanation on the next line.
    - `<Callout kind="tip" title="…">`: a tip, note or caution, drawn like the mixer's notices.
      Without a title it is a notice, as the mixer shows one.
    - `<Compare columns={[…]} />`: two lists side by side, each under its title.
    - `<Faq question="…">`: a question that opens to its answer (Troubleshooting).
    - `<Cards cards={[…]} />`: links to other pages, each a title and a line.
    - `<Flow label="…" paths={[[…]]} />`: signal paths, steps joined by arrows.
    - `<WebsiteLink>…</WebsiteLink>`: a link to the mixer on the website (its address is in
      `src/lib/site.ts`).
- **One screenshot, one place:** show a screen once, on the page that explains it, and link to it
  from elsewhere.
- **Search** needs no service: `src/pages/_website/guide/search.json.ts` renders each page's content at
  build time and cuts it into sections, and `src/lib/guide-search.ts` ranks them in the browser.
- **Screenshots** come from the real mixer, staged in headless Edge or Chrome, in light and dark.
  Nothing in it can reach a Volt. After changing how the mixer looks:

    ```sh
    pnpm build
    pnpm preview            # http://localhost:4321/volt-mixer/
    cd tools
    node guide-images.mjs   # rewrites public/guide/images and src/data/guide-images.json
    cd ..
    pnpm build              # the guide picks up the new sizes
    ```

    `tools/guide-stage.js` sets up each scene and numbers its parts; `tools/guide-images.mjs` says
    how large each one is shown, so small parts are shown bigger and their numbers stay readable.

The guide's styles and script load only on its pages, and the desktop app's build
(`VOLT_TARGET=desktop`, from `desktop/scripts/build-site.mjs`) leaves it out, so it adds nothing
to the mixer ([decisions](docs/decisions.md#one-site-two-builds)).

## Ground rules

These matter more than anything else in this guide. Pull requests that break them can't be merged.

- **Hardware safety.** Nothing may raise a level the user didn't move. Monitor level never goes
  below 0 on the wire, because the Volt jumps to full volume.
- **Only captured commands.** The page only sends bytes that were recorded from UAD Console and
  checked on the hardware. Never guess a command or send unknown bytes to "see what happens": it
  can put the device in a bad state or blast someone's ears.
- **Lean.** Astro (with MDX for the guide), TypeScript, Vitest and Prettier only (plus Electron in `desktop/`). Ask in an
  issue before adding any dependency.
- **Accessible.** WCAG 2.2 AA, including working at 320 CSS pixels wide.
- **Readable.** Functions up to about 25 lines, files up to about 400. Naming and test wording are
  in [CLAUDE.md](CLAUDE.md).
- **No private data in git.** Raw captures (`captures/`), UA API dumps (`reference/ua-api-*.json`)
  and UA's manuals hold your device's serial number or UA's copyright. `.gitignore` keeps them out;
  don't force them in.

## Add your audio interface

This is the most useful contribution, and the longest one. Read the whole section before starting.

### Can your interface be added?

The capture kit records what **UAD Console** sends, so it works for interfaces UAD Console
controls:

| Interface                                                   | Can it be added?                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Volt 2 Gen 2, Volt 2 Max, Volt 4 Max, Volt 4P Max, Volt 876 | Very likely. UAD Console controls them, so the same method applies.                          |
| Volt 1 Gen 2, first-generation Volts                        | No. UAD Console can't control them, so they have no mixer to control.                        |
| Apollo and other UA interfaces                              | Unknown. They use a different system (UA's Apollo software), so the kit would need new work. |
| Other brands                                                | Not with this kit. Open an issue to discuss first.                                           |

Today the code supports exactly one model. **The first new model also needs the code generalised**
to choose a protocol and channel list by USB product ID (see [step 8](#8-write-the-protocol-data)).
Open an issue saying which model you have before you start, so the approach can be agreed and
nobody does the work twice.

### What you need

- The interface itself, with a working mic or instrument and headphones to listen with.
- A **Windows** PC with **UAD Console** installed and working with your interface.
- [**USBPcap**](https://desowin.org/usbpcap/) (records USB traffic; reboot after installing) and
  [**Wireshark**](https://www.wireshark.org) (its `tshark` tool decodes the recordings). The
  defaults in both installers are fine.
- Node.js 24 and the repository, set up as in [Set up your computer](#set-up-your-computer).
- About two hours, with time to stop between steps.

### Working with an AI agent

Open the repository folder in your agent and start with something like:

> Read DEVELOPMENT.md, CLAUDE.md and docs/maintaining.md. I want to add support for my
> <model name>. Walk me through "Add your audio interface" one step at a time. Wait for me to
> confirm each physical step before going on, and never send commands to the device that haven't
> been captured from UAD Console.

Good habits:

- **Let it run commands, but do physical steps yourself**, and tell it when each is done. The
  capture prompts wait for you; nothing should run on a timer.
- **Ask it to explain anything you don't follow** before you move on. It has the same docs you do.
- **Ask it to show you the diff** before committing, and to check that no serial number is in it
  (step 10).
- If it suggests "probing" the device with guessed bytes, say no. That breaks the ground rules.

### 1. Make a branch

```sh
git checkout -b feat/<model>-support
```

For example `feat/volt-2-gen2-support`.

### 2. Install the capture tools

```sh
cd tools
pnpm install
```

`tools/` is its own pnpm project, in plain JavaScript on purpose
([decisions](docs/decisions.md#tools-stay-javascript)). `node-hid` lets the tools read the device
directly.

### 3. Get ready

Before any capture:

- **Take your headphones off and turn speakers down.** Captures step every level through its
  range. They mute the monitor and headphone outputs for the whole run and refuse to start if
  they can't, but Line Out 3/4 has no mute: unplug anything there, and set both cues' Mirror to
  None in UAD Console (a capture refuses to start while a cue is mirrored).
- **Unplug ribbon mics.** Captures switch 48V phantom power on and off, which can damage them.
- Make sure **UAD Console is running**: the tools talk to its helper on `127.0.0.1:4720`.
- Close Volt Mixer (website and app).

### 4. Identify your interface

```sh
node fingerprint.js          # firmware, Console, driver versions and HID report sizes
node ua.js info              # what UAD Console reports about the device
powershell -File hid-caps.ps1
```

Note down the **firmware version** and the **USB product ID**. `src/data/volt4-gen2.json` has a
`models` list mapping every known Volt product ID to its name.

`ua.js` reads UA's own API, which names every bus, input and control. Save a full dump for your
own reference (it stays local; `.gitignore` excludes it):

```sh
node ua.js tree {dev} 6 ../reference/ua-api-<model>.json
```

### 5. Take a "before" snapshot

```sh
node ua.js snapshot ../captures/snapshot-before.json
```

This records every setting so you can prove nothing was left changed at the end.

### 6. Record the captures

Each capture records USB traffic while settings change, with a timestamped log so every packet can
be labelled. Each run also saves a full snapshot first (`captures/snapshot-before-run.json`), puts
everything back at the end, even after an error or Ctrl+C, then compares every setting with the
snapshot and says loudly if anything differs. If anything ever looks wrong afterwards,
`node ua.js restore` puts the snapshot back.

1. **Try a dry run first.** It only reads, and prints the plan:

    ```sh
    node capture-run.js --dry-run
    ```

    `capture-run.js` finds your device's buses and outputs through UA's API. Check that the plan
    lists the inputs, buses and outputs your interface really has. If it fails or misses things,
    this is where the tool needs adapting for your model (it was written on a Volt 4 Gen 2).

2. **The automated sweep** (accept the administrator prompt: only the USB recorder needs it, and
   it records only the Volt when USBPcap can tell which device it is):

    ```sh
    powershell -File run-capture.ps1
    ```

    It steps every setting through UAD Console while recording. About 15 minutes, mostly
    unattended. `-Phases routing,autogain` runs only some phases (the names are in
    `capture-run.js`).

3. **Console starting up**, which shows the full state Console pushes when it connects:

    ```sh
    powershell -File run-capture.ps1 -Mode startup
    ```

4. **Front-panel controls** (knob, buttons, display menu), which only you can press:

    ```sh
    powershell -File run-capture.ps1 -Mode manual
    ```

    It prompts one action at a time and waits for you to press Enter. Use `-From <step>` to resume.
    The steps in `manual-prompts.js` are the Volt 4 Gen 2's; adjust them to your front panel first.

The recordings land in `captures/` as `volt-<timestamp>-hub<n>.pcap` with a `run-log.jsonl`.

### 7. Decode them

```sh
node decode-capture.js ../captures/volt-<timestamp>-hub1.pcap ../captures/run-log.jsonl
```

This writes `reference/decoded/<firmware>/` with `steps.json`, `packets.json` and `summary.md`.
`summary.md` is a table: for each setting, which payload bytes change. Device paths are written as
`{dev}` and the serial number is removed, so this folder is safe to commit. Name the folder so the
model is clear, for example `reference/decoded/volt2-gen2-1.0.3/`.

Two more maps the page needs:

- **The state dump** (how the device reports its current settings):

    ```sh
    node state-probe.mjs --dump   # read-only: print one dump
    node state-probe.mjs          # change one setting at a time and map the dump
    ```

    It writes `reference/decoded/<firmware>-state/state-map.json`. Like the sweep, it mutes the
    outputs, saves and restores a full snapshot, and checks the dump is back as it was. It imports
    the protocol from `src/lib/spec.ts`, so for a new model it needs the identify and
    state-request commands from the decode above first.

- **The meters** (read-only):

    ```sh
    node meter-probe.mjs in1-mic 6   # label, seconds; play into one input at a time
    node meter-probe.mjs --raw 3 6   # one meter's raw values (offset, seconds), to spot spikes
    ```

    Results go to `reference/decoded/meters.jsonl`.

Compare your `summary.md` with `reference/decoded/1.0.3.0/summary.md` (the Volt 4 Gen 2). Most
Volts are likely to share the command layout and differ in channel counts.

### 8. Write the protocol data

Create `src/data/<model>.json` with the same shape as `src/data/volt4-gen2.json`: `device`,
`vendorId`, `productId`, `models`, and a `firmware` entry keyed by your firmware version. The
`ISpec` interface in `src/lib/spec.ts` documents each field. Every number must come from your
decoded captures; `verifiedFrom` says which capture each came from.

`missingFromSpec` in `src/lib/spec.ts` refuses a spec that lacks any command the page sends, and
the page then stays read-only. That's the safety net: an incomplete spec can't send a guessed byte.

Because the code supports one model today, the first new model also needs these changes. Ask your
agent to make them in small, separate commits:

| File                              | Today                                           | Needs                                       |
| --------------------------------- | ----------------------------------------------- | ------------------------------------------- |
| `src/lib/spec.ts`                 | imports `volt4-gen2.json` only                  | every data file, and a lookup by product ID |
| `src/scripts/transport-webhid.ts` | accepts only `protocol.productId`               | any product ID with a data file             |
| `desktop/src/hid-transport.ts`    | accepts only `protocol.productId`               | any product ID with a data file             |
| `src/lib/mixer.ts`                | one fixed `channels` list (Input 1 … Loopback)  | the channel list per model                  |
| `desktop/scripts/*.mjs`           | the app's Volts and udev rule: `productId` only | every supported product ID                  |
| `README.md`                       | "Only the Volt 4 Gen 2 works for now"           | your model listed                           |

Keep the Volt 4 Gen 2 working exactly as before: its tests must still pass unchanged.

### 9. Test it

Add your decoded folder to the round-trip tests in `src/lib/commands.test.ts` (see how
`decoded("1.0.3.0")` is used): every recorded command must re-encode to the same bytes. Then:

```sh
pnpm test
pnpm lint
pnpm build
```

Then try it on the hardware, **with UAD Console closed**, starting with levels low:

```sh
pnpm build && pnpm preview
```

Open the address it prints in Edge or Chrome, choose **Connect Volt**, and check each control
against the device's own display and your ears: faders, pan, mute, solo, links, cue mixes, preamp
gain, 48V (with nothing plugged in or a condenser mic), tone, monitor and headphone levels, meters.
Note what you checked; the pull request asks for it.

Finally, take an "after" snapshot and compare:

```sh
cd tools
node ua.js diff ../captures/snapshot-before.json
```

It compares the snapshot with the device now and should say `identical`. If not,
`node ua.js restore ../captures/snapshot-before.json`.

### 10. Check what you're committing

```sh
git status
git diff --stat
```

You should see your `src/data/<model>.json`, your `reference/decoded/...` folders, code and test
changes, and docs. You should **not** see anything in `captures/`, any `reference/ua-api-*.json`, or
any `.txt` manuals. Search the decoded output for your serial number (it's on the device's label
and in `node ua.js info`):

```sh
git grep -i "<your serial number>"
```

That should find nothing.

Also add what you learned to [docs/protocol.md](docs/protocol.md): which commands match the Volt 4
Gen 2, which differ, and anything new.

## Open a pull request

1. **Commit** with [Conventional Commits](https://www.conventionalcommits.org/) messages, for
   example:

    ```sh
    git add src/data reference/decoded src/lib docs
    git commit -m "feat: support the Volt 2 Gen 2"
    ```

    Use `feat:` for new features, `fix:` for bug fixes, `docs:` for documentation, `test:` for
    tests. Several small commits are easier to review than one large one.

2. **Push** your branch to your fork:

    ```sh
    git push -u origin feat/<model>-support
    ```

3. **Open the pull request** against `naovixen/volt-mixer`'s `main` branch, on GitHub (it offers a
   button after you push) or with `gh pr create`. In the description, include:
    - the model and firmware version;
    - which captures you made, and where they are in `reference/decoded/`;
    - what you checked on the hardware, and anything you couldn't check (for example, no speakers);
    - that the before and after snapshots matched;
    - which issue it closes (`Closes #<number>`).

Before opening it, `pnpm lint`, `pnpm test` and `pnpm build` must all pass. By contributing you
agree that your work is licensed under the [MIT licence](LICENSE).

## Platform notes

### Linux USB access

The `.deb` sets this up for you. For the AppImage, or the website in Chrome, add a udev rule once,
then unplug and replug the Volt:

```sh
echo 'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="2b5a", ATTRS{idProduct}=="002e", TAG+="uaccess"' | sudo tee /etc/udev/rules.d/70-volt-mixer.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

On GNOME, tray icons need the AppIndicator extension, and the tray mixer opens from the icon's
menu.

### Windows

The builds aren't signed, so SmartScreen warns on first launch (**More info › Run anyway**).
Windows hides new tray icons: turn Volt Mixer's on in **Settings › Personalisation › Taskbar ›
Other system tray icons**. For the phone remote, allow Volt Mixer through the firewall on private
networks when Windows asks.

### macOS

Open it once, then **System Settings › Privacy & Security › Open Anyway**. The icon is in the menu
bar.

Only Windows has been tried with a Volt so far; reports from macOS and Linux are welcome.

## Releases

For maintainers: bump `desktop/package.json`'s version, then push a matching `v*` tag (the
release fails if they differ). `.github/workflows/release.yml` builds every system's installer
with read-only access, then a separate job attaches them to the tag's draft release, to be checked
and published by hand. The draft's notes are written from the Conventional Commits since the
previous tag (`.github/scripts/release-notes.mjs`): `feat`, `fix`, `perf` and anything marked
breaking, so a commit's subject is what users read; edit them in the draft before publishing. Try
them first with `node .github/scripts/release-notes.mjs HEAD`. A manual run of the workflow only builds, and keeps the installers as
artefacts. Every action in both workflows is pinned to a commit: when you update one, look up the
new release's commit and keep the `# vX.Y.Z` comment beside it. The website deploys from `main`
through `.github/workflows/deploy.yml`.
