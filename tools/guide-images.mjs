// Screenshots for the guide (src/pages/guide), in light and dark, from the built mixer page in
// headless Edge or Chrome. guide-stage.js sets each scene up; nothing here can reach the Volt.
// Re-run after changing how the mixer looks:
//   pnpm build && pnpm preview          then, in tools/:
//   node guide-images.mjs [url]         default http://localhost:4321/volt-mixer/; CHROME_PATH picks the browser
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { meterFill } from "../src/lib/meters.ts";
import { defaultState, setLinked } from "../src/lib/mixer.ts";
import { qrCode } from "../src/lib/qr-svg.ts";
import { newestSpec } from "../src/lib/spec.ts";
import { dbToPosition, formatDb, formatPan } from "../src/lib/taper.ts";
import { trayRows } from "../src/lib/tray-rows.ts";
import { findBrowser, quietBrowserArgs } from "./lib/browser.mjs";
import { closeBrowser, connect, evaluate, findTarget } from "./lib/cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "public", "guide", "images");
const sizesFile = path.join(here, "..", "src", "data", "guide-images.json");
const pageUrl = process.argv[2] ?? "http://localhost:4321/volt-mixer/";
const port = 9339;

const browser = findBrowser();
const { faderMaxDb } = newestSpec();
const fader = (db) => ({ position: dbToPosition(db, faderMaxDb), text: formatDb(db) });
const level = (value) => ({ position: value / 100, text: value.toFixed(1) });

/* The mix every scene starts from: a voice, a guitar, a console on Line 3/4 and music on Loopback. */
const mixer = {
    strips: [
        {
            ids: "in1",
            name: "Vocal mic",
            icon: "mic-vocal",
            tone: "Warmth",
            phantom: true,
            hasPhantom: true,
            fader: fader(0),
            meters: [meterFill(-9)],
        },
        {
            ids: "in2",
            name: "Guitar",
            icon: "guitar",
            tone: "Focus",
            hasPhantom: true,
            fader: fader(-4),
            meters: [meterFill(-18)],
        },
        {
            ids: "in3",
            joins: "in4",
            name: "PS5",
            icon: "gamepad-2",
            tone: "Off",
            linked: true,
            fader: fader(-12),
            meters: [meterFill(-24), meterFill(-26)],
        },
        {
            ids: "loopbackL,loopbackR",
            name: "Music",
            icon: "music",
            fader: fader(-20),
            meters: [meterFill(-30), meterFill(-31)],
            muted: true,
        },
    ],
    outputs: { monitor: level(35), headphone: level(45), mix: [meterFill(-8), meterFill(-10)] },
};
const channel = {
    ids: "in1",
    name: "Vocal mic",
    icon: "mic-vocal",
    gain: { position: 32 / 60, text: "32.0 dB" },
    toneIndex: 1,
    pan: { position: 0.5, text: formatPan(0) },
    send: fader(-6),
};
const settings = {
    brightness: { position: 0.6, text: "60%" },
    mixLink: "https://naovixen.github.io/volt-mixer/#m=AQ…",
};

/* The same mix as the tray mixer and the phone remote show it (src/lib/tray-rows.ts). */
const trayState = (() => {
    const state = defaultState();
    setLinked(state, ["in3", "in4"], true);
    Object.assign(state.names, { in1: "Vocal mic", in2: "Guitar", in3: "PS5", in4: "PS5" });
    Object.assign(state.icons, { in1: "mic-vocal", in2: "guitar", in3: "gamepad-2", in4: "gamepad-2" });
    [0, -4, -12, -12].forEach((db, i) => Object.assign(state.channels[`in${i + 1}`], { fader: db, isMuted: false }));
    state.headphone.level = 45;
    state.monitor.level = 35;
    state.tone = [1, 2, 0, 0];
    return state;
})();
const traySnapshot = {
    rows: trayRows(trayState, { isDigitalShown: false, isLoopbackShown: false }, []),
    maxDb: faderMaxDb,
    isLive: true,
    isMixOwned: true,
    status: "Connected",
    statusKind: "on",
    mixLink: settings.mixLink,
};

/*
 * Each shot: its scene in guide-stage.js and the scene's data, the browser's size, how much larger
 * the guide shows it (`zoom`: small parts are shown bigger, and taken sharper to match) and how big
 * its numbers are. A wide shot is shown smaller, so its numbers are drawn bigger.
 */
const desk = { width: 1240, height: 900 };
const tall = { width: 1240, height: 2600 };
const shots = {
    overview: { scene: "overview", data: mixer, view: { width: 1060, height: 900 }, badge: 34 },
    strip: { scene: "strip", data: mixer, view: desk, zoom: 1.5 },
    outputs: { scene: "outputs", data: mixer, view: desk, zoom: 1.4 },
    setup: { scene: "setup", data: {}, view: { width: 900, height: 700 } },
    carry: { scene: "carry", data: { qr: qrCode(settings.mixLink) }, view: { width: 390, height: 844 }, mobile: true },
    "phone-none": { scene: "phoneNone", data: {}, view: { width: 390, height: 844 }, mobile: true },
    tray: { scene: "tray", data: { snapshot: traySnapshot }, view: { width: 340, height: 385 }, page: "tray/" },
    remote: {
        scene: "tray",
        data: { snapshot: traySnapshot, isPhone: true },
        view: { width: 390, height: 400 },
        mobile: true,
        page: "tray/",
    },
    channel: { scene: "channel", data: { ...mixer, channel }, view: tall },
    cue: { scene: "cue", data: { ...mixer, channel }, view: tall, zoom: 1.25 },
    "settings-device": {
        scene: "settings",
        data: { ...mixer, settings, groups: ["device", "routing"] },
        view: tall,
        zoom: 1.25,
    },
    "settings-view": { scene: "settings", data: { ...mixer, settings, groups: ["view"] }, view: tall, zoom: 1.25 },
    "settings-desktop": {
        scene: "settings",
        data: { ...mixer, settings, groups: ["desktop"] },
        view: tall,
        zoom: 1.25,
    },
    "settings-mix": { scene: "settings", data: { ...mixer, settings, groups: ["your-mix"] }, view: tall, zoom: 1.25 },
    "settings-about": { scene: "settings", data: { ...mixer, settings, groups: ["about"] }, view: tall, zoom: 1.25 },
};

const launch = async (profile) => {
    const args = [
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        ...quietBrowserArgs,
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        "about:blank",
    ];
    const child = spawn(browser, args, { stdio: "ignore" });
    try {
        const page = await findTarget(
            port,
            (target) => target.type === "page" && target.url === "about:blank",
            child,
            50,
        );
        return { child, socketUrl: page.webSocketDebuggerUrl };
    } catch (error) {
        child.kill();
        throw error;
    }
};

const stage = fs.readFileSync(path.join(here, "guide-stage.js"), "utf8");
/* The tray page asks the app's preload for its rows (src/scripts/tray-link.ts); this stands in for it. */
const trayStandIn = `window.voltTray = {
    fitTray: () => {}, hideTray: () => {}, openMainWindow: () => {}, hello: () => {},
    sendIntent: async () => "ok",
    onSnapshot: (listen) => { window.__showTraySnapshot = listen; },
};`;
const ready = fs.readFileSync(path.join(here, "guide-ready.js"), "utf8");

/** Shoots one shot in one theme; returns the size the guide shows it at. */
const shoot = async (cdp, file, { scene, data, view, zoom = 1, badge = 26, mobile = false, page = "" }, theme) => {
    const deviceScaleFactor = Math.max(2, Math.ceil(2 * zoom));
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...view, deviceScaleFactor, mobile });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    await Promise.all([
        cdp.once("Page.loadEventFired"),
        cdp.send("Page.navigate", { url: new URL(page, pageUrl).href }),
    ]);
    await evaluate(cdp, "guideReady()");
    await evaluate(cdp, stage);
    await evaluate(cdp, `guideScenes.badge(${badge})`);
    const clip = await evaluate(cdp, `guideScenes[${JSON.stringify(scene)}](${JSON.stringify(data)})`);
    await evaluate(cdp, "guideReady()");
    const { data: image } = await cdp.send("Page.captureScreenshot", {
        format: "webp",
        quality: 88,
        clip: { ...clip, scale: 1 },
    });
    fs.writeFileSync(path.join(outDir, `${file}-${theme}.webp`), Buffer.from(image, "base64"));
    return { width: Math.round(clip.width * zoom), height: Math.round(clip.height * zoom) };
};

const shootAll = async (cdp) => {
    await cdp.send("Page.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: ready });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: trayStandIn });
    const sizes = {};
    for (const theme of ["light", "dark"]) {
        for (const [file, shot] of Object.entries(shots)) sizes[file] = await shoot(cdp, file, shot, theme);
    }
    // What src/components/guide/Shot.astro shows each one at.
    fs.writeFileSync(sizesFile, `${JSON.stringify(sizes, null, 4)}\n`);
    for (const [file, { width, height }] of Object.entries(sizes)) console.log(`${file} ${width}×${height}`);
};

const main = async () => {
    fs.mkdirSync(outDir, { recursive: true });
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "volt-guide-"));
    let child = null;
    try {
        const launched = await launch(profile);
        child = launched.child;
        const cdp = await connect(launched.socketUrl);
        try {
            await shootAll(cdp);
        } finally {
            cdp.close();
        }
    } finally {
        if (child) await closeBrowser(child, profile);
        else fs.rmSync(profile, { recursive: true, force: true });
    }
};

await main();
