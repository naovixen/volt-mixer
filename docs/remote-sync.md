# Remote sync: home, work and phone

Whether a live link between computers (and a phone) is needed, and what it would take.

**Built (October 2026), with no online service:** short `#m=` mix links and QR codes
(`src/lib/mix-code.ts`, `src/lib/qr-svg.ts`), and option 1 below, the phone remote
(`desktop/src/phone.ts`, `src/scripts/tray-link.ts`). No hosted relay: the user wanted nothing to
sign up for, and the work network likely forbids it. Keeping the app's and the website's mixes in
step on one computer was built in 0.2.0 and dropped in 0.2.1 (`docs/decisions.md`).

## What already stays in step

Everything the Volt can report is read from it on every connect: mutes, 48V, preamp gain, tone,
stereo links, Monitor and Headphone levels and mutes, Clip Protection, brightness, the digital input
format. The front panel's changes also arrive live. So after a KVM switch the other computer shows
what the Volt is really doing, and none of this needs syncing.

## What doesn't

The Volt can't report its mix: fader, pan and cue-send levels (crosspoints) and cue routing. Like
UAD Console, each computer keeps its own copy and pushes it on connect (`src/lib/engine/session.ts`
`onFirstState` → `src/lib/engine/ownership.ts` `takeOwnership`). So:

1. At home you pull Line 3/4 down by 10 dB.
2. The KVM switches to the work laptop. Its page connects and pushes its own, older mix.
3. Line 3/4 is back where it was.

Today the cure is a mix link (Settings › Your mix › Copy link). **This is the real case for sync**:
the saved mix, which is small (a few KB of JSON) and changes rarely.

## Phone control

A phone can't reach the Volt: the Volt is on the computer's USB, and neither Android nor iOS
browsers have WebHID. A phone can only ask the computer that has the Volt to make a change. So
phone control needs that computer to accept remote commands, which a web page can't do (it can't
listen for connections); it can only connect out to something.

## Options

| Option                       | Home ↔ work mix | Phone at home | Phone anywhere | Runs on                       | Cost and risk                                                                                                                                                     |
| ---------------------------- | --------------- | ------------- | -------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. LAN remote in desktop app | no              | yes           | no             | the desktop app               | No cloud. Pairing by QR code with a token; serves the tray page to the phone over the home network. Only while the desktop app is the one connected.              |
| 2. Hosted relay              | yes             | yes           | yes            | a small hosted service        | Someone runs it (e.g. a Cloudflare Worker + Durable Object, free tier; GitHub Pages can't host WebSockets). The work network or IT policy may block or forbid it. |
| 3. WebRTC, peer to peer      | yes             | yes           | yes            | a signalling server, then P2P | Still needs a server to introduce the peers, so no saving over 2; more moving parts (NAT traversal).                                                              |
| 4. Mix links (today)         | by hand         | no            | no             | nothing                       | None. Could add a QR code so a phone camera can carry a mix to another computer.                                                                                  |

How option 2 would work:

- Each computer and the phone join a "room" from a pairing code shown once on the first computer.
- The saved mix (`ISavedMix`, `src/lib/saved-mix.ts`) travels end-to-end encrypted with WebCrypto
  (AES-GCM, key derived from the pairing code), so the relay only sees ciphertext. Last writer
  wins by timestamp; on connect, a computer fetches the latest before it pushes.
- The phone sends intents (the same ones the tray mixer uses, `src/lib/intents.ts`) to whichever
  computer currently holds the Volt; that computer applies them through `applyIntent`, so every
  hardware-safety rule (no jumps, clamped values, nothing until the mix is owned) holds for remote
  input too. Incoming mixes go through `adoptSavedMix`, which already validates untrusted input.

## Recommendation

- **Phone control at home:** option 1, built into the desktop app when wanted. No infrastructure,
  nothing leaves the home network.
- **Home ↔ work:** keep mix links unless stale mixes after a KVM switch actually get in the way.
  If they do, option 2, but check first that the work network allows outbound WebSockets to the
  relay and that IT policy is fine with it.
- Option 3 isn't worth it here.
