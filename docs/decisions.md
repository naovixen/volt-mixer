# Decisions

Choices the code cannot explain, and where this project differs from naovixen's conventions.

## WebHID, so Edge and Chrome only

The Volt's mixer is controlled with HID output reports (`docs/protocol.md`). Only Chromium
browsers ship WebHID. Its USB MIDI port doesn't reach the mixer (tested: SysEx is ignored), so Web
MIDI isn't an alternative. Firefox and Safari get a clear "open this in Edge or Chrome" message.
This departs from naovixen's "every current browser gets the same experience", because no
cross-browser way exists.

## Script is required

Talking to USB needs script, so the page can't work without it (naovixen's "works with JavaScript
off"). With script off it explains what it is and what it needs.

## The page owns the mix, like UAD Console

The Volt reports everything except crosspoint gains (fader, pan and cue-send positions) and cue
routing. Console doesn't read them either: it pushes its own saved mix every time it starts.
The page does the same: on connect it reads the state dump, then applies this computer's saved mix
(per Volt serial, in localStorage). Readable settings (mutes, 48V, gain, tone, links, levels) always
come from the Volt. Each computer keeps its own copy; a `#mix=` link carries it to the other one.
Until a computer has a mix, no level is sent. `docs/remote-sync.md` looks at keeping that copy in
step over the network, and at phone control.

## Click to set, on every slider

A press on a slider's track sets the value there, levels included, then drags on from it; a press
on the handle drags it from where it is. Sliders used to be drag-only so a click could never jump
a level, but the user chose click-to-set everywhere (2026-10-24), knowing a stray click high on a
level is a sudden loud jump. Levels still aren't ramped in code. End and a double-click go to
0 dB on faders and cue sends, from anywhere (like a console's reset), and do nothing louder on
level controls.

Only the main button of the pointer that pressed counts, and a finger sets a level only with a
tap: on the phone remote every row is a slider, and a swipe meant to scroll mustn't set one. A
drag moves a value only the way the pointer moved (`dragValue` in `src/lib/slider-models.ts`):
sliders round to their steps, so a level the Volt reported between steps (gain 37.3 dB) would
otherwise jump up on the first pointer event of a press that didn't move.

## A link takes the quieter side

Console copies the left channel to the right when a pair links, which can turn the right side up.
Here a link, from the page or the Volt's INPUT button, gives both sides the quieter side's
settings instead: the lower fader and sends, muted if either is, and on Inputs 1/2 the lower
preamp gain (`matchQuieterMix`, `matchQuieterGain` in `src/lib/mixer.ts`). A saved mix whose
linked sides differ is evened out the same way. So a link never turns a fader or send up.

The pans still go hard left and right, as in Console, which sends the same bytes: a centred leg is
−3 dB, a hard-panned one 0 dB. The pair's power is unchanged, so a stereo source sounds as loud as
before, but a source on one side alone now plays from one speaker, 3 dB louder there. Keeping
Console's crosspoints was chosen over scaling the linked legs down, so the Volt plays the same mix
whichever program set it; the guide says what happens. Loopback is the computer's own stereo and
is always linked: no intent, saved mix or link can split it (`isAlwaysLinked`).

## Lean toolchain

Astro (with `@astrojs/mdx` for the guide), TypeScript, Vitest and Prettier, plus `uqr` at runtime for
the mix link's QR code (a few kilobytes, no dependencies; drawn as SVG by `src/lib/qr-svg.ts`).
No ESLint, Stylelint, Playwright or axe packages: browser
and accessibility checks are done by hand with the Claude in Chrome extension. The 25-line function
and 400-line file limits are followed by hand.

## Tools stay JavaScript

`tools/` is the home-PC capture kit (USBPcap, node-hid, UA's local API). It isn't deployed, runs
against real hardware, and changes slowly, so it stays plain Node scripts. It imports `src/lib`
directly (Node 24 runs TypeScript), so there's one protocol implementation.

## Panels scroll their body, never their header

A dialog (or any panel with a title bar) is a column: the header stays put and only the body
scrolls, so the scrollbar starts below the header line rather than running beside it.
`src/components/ui/Dialog.astro` does this for every dialog; new panels follow the same pattern
instead of a sticky header inside a scrolling box.

## Component styles are flat selectors

Astro scopes a component's `<style>` by adding its class to each selector it can see, but not to
the selectors nested inside another rule: `.setting { & .control {} }` reaches every `.control`
in the row, including a Slider's. So in a component, nesting is only for the element's own states
(`&:hover`, `&[aria-pressed]`), pseudo-elements and media queries. A descendant is written as a
selector of its own (`.setting > .setting-control`), which Astro scopes, with a name that says
whose it is. Reaching into a slot or a child component is deliberate and says so, with
`:global()`, preferably on a direct child (`.link-field > :global(.button)`). The global
stylesheets in `src/styles` are unscoped anyway, so they nest freely.

## The desktop app is Electron, and the page drives the Volt there too

`desktop/` wraps the same site in Electron for home computers that want it without a browser,
with a tray mixer. Electron ships Chromium, so WebHID works the same on Windows, macOS and Linux
and the page's own connection code (`src/scripts/volt-connection.ts`) runs unchanged; main only
grants the permission Chrome would ask for. A smaller shell (Tauri) uses the system web view, which
has no WebHID on macOS or Linux, so the USB part would have to be rewritten natively.

- The site is served from `app://volt/`, a secure origin where its root-absolute URLs resolve, with
  a strict CSP (`script-src 'self'`; `public/theme.js` is a file for that reason).
- The main window keeps the only connection to the Volt, so it's hidden rather than closed while
  the app is in the tray (`backgroundThrottling: false`, and `commit()` doesn't rely on animation
  frames). The tray window (`src/pages/tray`) only draws rows and sends intents
  (`src/lib/intents.ts`) over a `BroadcastChannel`; the main window checks and applies them.
- Each window has its own preload: the tray's can only size and hide itself and open the main
  window, and main answers each IPC message only from the window it's for (`isFromMainWindow`,
  `isFromTrayWindow`), so a tray page can't reach the settings, the phone remote's pairing link or
  the Volt.
- Builds are unsigned (GitHub Releases): no paid certificates. macOS builds are signed ad hoc so
  Apple silicon opens them. Updates are a check and a link, not an automatic install.
- Electron, electron-builder and the main process's TypeScript live in `desktop/` with their own
  `package.json`, so the site's toolchain stays Astro, TypeScript, Vitest and Prettier.

## Other devices without a server

Nothing is hosted, so nothing needs an account and the work laptop reaches nothing new
(`docs/remote-sync.md`). A mix travels as a short `#m=` link or QR code: a compact binary form
that rounds levels down, so a link can never make anything louder. The phone remote is the tray
page served by the app on the home network, only on the address it was set up on, so a laptop
that starts at login on another network stays off. Phones send switches as target states (`to`)
and every change with a rising sequence number, so a message that arrives twice or late can't undo
a newer one. It's plain HTTP (a phone can't trust a certificate this app makes up), so the pairing
token from the QR code is never sent: it's the key for an HMAC-SHA256 signature on every request
(`src/lib/phone-signature.ts`, `desktop/src/phone-auth.ts`). A stream opens by signing a challenge
the app made up, used once, and each change is signed with that challenge and its sequence number,
so a request copied off the network can't be played again. Someone watching the network can see
the mix, but not change it. The phone's page isn't a secure context, so it has no `crypto.subtle`;
`src/lib/hmac.ts` is a small SHA-256 and HMAC, checked against the RFC 4231 and NIST vectors.

## No mix sync between the app and the website

Version 0.2.0 kept the website's mix in step with the desktop app on the same computer, over
`127.0.0.1`. It was dropped in 0.2.1. Both drive the same Volt, so taking the other side's mix
meant re-sending it, which could land after a newer change and briefly play an older, louder
level; a new connection pushed its own mix before it heard from the other; and Forget didn't
stick. It only helped on a computer that has the app, where the website isn't needed. The Volt's
own settings (levels, mutes, 48V, gain, tone, links) need no sync: every page re-reads them from
the Volt.

Two Volt Mixers on one computer would still fight over the mix, and the website's faders would
show levels the Volt isn't playing. They can't talk, but every program with the Volt open
receives every state reading, and each re-reads every 1.5 s, so readings a page didn't ask for
mean another one is open (`src/lib/other-program.ts`). The desktop app keeps its mix and says the
browser is open; the website pauses its mix until the other one closes, and listens for 3.5 s
after connecting before it applies its own (`src/scripts/mix-pause.ts`). Two browsers both pause
and say so. UAD Console doesn't re-read, so it isn't noticed.

## Every change is an intent

Each change a user makes, from the page's controls, the tray window or a phone, is an intent
(`src/lib/intents.ts`) applied by `applyIntent` and committed by `src/scripts/run-intent.ts`, so
clamping, "this needs the mix first" and the linked-pair rules live in one place and the views
never write page state: an intent for one side of a linked pair moves both, whatever view sent it.
The views don't re-check "needs the mix" either: a fader moved before this computer has a mix is
refused by `applyIntent`, put back, and the page says why. Another window or a phone may only send
the remote intents (`isRemoteIntent`), the ones the tray has: levels and mutes, each mute saying
where it goes (`to`), since a message can arrive twice. Not solo, links, mono, 48V, routing or
names. Only the desktop app answers them: its origin is its own, while on the website any page
of the same origin could post to the channel.

## Lasting conditions aren't messages

The notice bar holds the page's lasting conditions (an unchecked firmware with its Use anyway, a
second tab, another Volt Mixer with the mix, a Volt that sent no settings), each until it no longer
holds, and below them the latest passing message (`src/scripts/notices.ts`). They used to share
one slot, so a passing "Mix applied" could replace Use anyway, the only way to let the page send.
Whether the mix can go on the Volt now is one question (`canApplyMix`), and why it's held back is
one state (`app.mixHold`: listening after connecting or taking over from another tab, or another
Volt Mixer open). Owning the mix means nothing holds it back: a mix taken while it's held is kept
for later (`takeOwnership`), so nothing this page sends can fight the other Volt Mixer.

A solo on a strip that isn't shown silences the rest of the monitor mix with no button in sight,
so it's a condition too, with Clear the solo (`src/scripts/hidden-solo.ts`). The page never ends
a solo itself, on hiding a strip or switching the digital format: that would turn every other
channel back up.

## Unseen, the app idles

The desktop app spends most of its life in the tray, so the hidden main window must cost next to
nothing. Background throttling stays off (the hidden window answers the tray, phones and the Volt
on time, and keeps re-reading the Volt every 1.5 s, which is how a Volt Mixer in a browser notices
the app and leaves it the mix), but that also makes the hidden page count as visible. So the app
tells the page when its window is shown (`window:visible`, `src/scripts/page-visibility.ts`), and
while it's unseen the page neither reads the Volt's 50-a-second meter reports nor updates its
views; it catches up when shown. Seen, a meter is drawn only while it moves, and a peak falls by
time, not by frames.

## The page picks its mode first

A browser with WebHID drives a Volt; one without (a phone, Firefox, Safari) can only carry a mix
link to a computer that can. The controller decides which before wiring anything, and gives each
mode its own way to take in a link (`LinkReceiver`): applied or kept for the Volt, or carried. A
second link opened on a phone used to be kept as if a Volt would connect.

## The app turns the display off itself at shutdown

With its computer off, the Volt shows its Host screen at the stored display brightness (its
button lights flash whatever we do, `docs/protocol.md`), so the desktop app can turn the display
off at sleep and shutdown (Settings › Desktop app). Windows goes on with a shutdown as soon as the
window answers `WM_QUERYENDSESSION`, too soon for a report sent from the page, and holding main
doesn't help because the request to the page waits too. So main writes the report itself with
node-hid (`desktop/src/display-fade.ts`), synchronously, before it answers: about 20 ms. The build
works the report out from `src/lib/commands.ts` into the site (`desktop-hid.json`, read by
`desktop/src/volt-hid.ts`), so the protocol stays in `src/data` and main never writes bytes a page
gave it. The page only says whether it's driving a Volt: one with firmware it doesn't know waits
for the user's go-ahead, and so does this. Off is raw 1, which
nothing else sets, so whichever page connects next, on either computer, fades it back up. A
Windows service or a shutdown script would also get time, but each needs installing per computer.

## The guide is MDX, with no docs framework

The user guide is a content collection of MDX pages (`src/content/guide`) with its own layout,
not Starlight, and its search is a small index built with the site (`search.json.ts`,
`src/lib/guide-search.ts`), not Pagefind. A dozen pages don't need either. `@astrojs/mdx` was
added (with the user's agreement, 2026-10-24) so pages can use real components: screenshots that
size themselves, tips drawn with the mixer's own notice style (`.message-box`), and comparisons.
As naovixen does, the pages import nothing: their components, and the ones that draw every table
(a scroll region the keyboard can reach) and numbered list, are one map passed to `<Content>`
(`src/pages/_website/guide/_entries.ts`), which the search index renders with too. Each page's
front matter says its group and place, so the collection is the one list of pages and titles.
The guide's stylesheets are imported with `?url`, because `cssCodeSplit: false` would otherwise
put them in the mixer's one stylesheet. The sidebar is a popover on narrow screens, so it opens
without script; only search needs script. Screenshots are taken from the real page, staged in
headless Edge (`tools/guide-images.mjs`), so they can be retaken whenever the mixer changes, and
the guide is updated with every change a user can see.

## One site, two builds

The website and the desktop app's copy of it (`desktop/site`) are two builds of the same site.
`VOLT_TARGET=desktop` (`desktop/scripts/build-site.mjs`) serves it from the root of `app://volt/`
and leaves out what the app opens on the website instead (the guide, its search, privacy and the
sitemap, and the public files only they use): those routes live in `src/pages/_website`, which
Astro doesn't route by itself, and `astro.config.ts` adds them for the website only. So nothing
depends on how the bundler names its chunks. The website's address is written once, in
`src/lib/site.ts`: the build takes its path from it, and canonical links, structured data, the
sitemap and the guide's link to the mixer point there from either build.

## A phone carries a mix; nothing pushes one

With no server, nothing can put a mix into a browser on another computer: something has to be
opened or scanned there. So a browser that can't reach a Volt (a phone) keeps a mix link it's
given and shows it as a QR code and a link (`src/scripts/carry-mix.ts`), to scan with the other
computer's camera or send on. It works with just the website, so it reaches the work laptop.

So the phone has two jobs, each with one QR code in one place: carrying a mix (Settings › Your
mix › QR code, any browser) and the phone remote (Settings › Desktop app › Phone remote, the app
only, because only the app can listen for a phone). Each points to the other, and neither QR code
is shown in a second place. The phone remote also offers "Keep this mix on my phone", which opens
the mix link on the website (the remote's own origin can't keep it), so app users need one scan.

## Monitor level is a u16, the same control as the headphone level

Monitor and headphone outputs are the same kind of control: Console shows each 0–100, and on the
wire each is a little-endian **u16**, raw = 10 × level, full scale 1000 (Console 100). The page
originally encoded the monitor level as a single byte, raw = 2 × level, max 200 — so its slider
reached only a fifth of the real volume, and it misread a monitor level Console had set high. The
mistake survived into firmware 1.0.5 because every capture until then only moved the monitor level
about 20 % of the way, so its high byte and true maximum were never seen; it was caught (and fixed,
`monitorLevelPerUnit` 10, `monitorLevelMax` 1000, u16 in `muteWord` and both parsers) only when a
capture finally drove the knob to the top. Saved mixes don't carry output levels, so the fix can't
make an old mix play louder; the below-0 clamp (the Volt jumps loud below 0) stays. The maintenance
flow now drives every continuous control to its limit and checks each scaled maximum against the
device, so an under-scaled control can't hide again (`docs/maintaining.md`).

## A firmware verified identical aliases another, rather than duplicating it

`src/data/volt4-gen2.json` is keyed by the version the Volt reports over HID identify, and the page
only sends to a firmware whose key it holds exactly. A minor firmware revision is often byte-identical
to the one before. Rather than copy a spec under the new key (130 lines to keep in step) or leave the
page read-only on a firmware we've checked, a verified-identical firmware is an alias —
`"1.0.5": { "sameAs": "1.0.3", "verifiedFrom": "…" }` — which `specFor` resolves to the named spec and
counts as an exact match. The data stays lean and honest about which firmwares were checked and how; a
firmware that genuinely differs gets its own full spec instead.
