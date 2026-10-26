// Runs the desktop app from source for perf-bench.mjs, against the pretend Volt in its main process
// (desktop/src/hid-backend-fake.ts, chosen by VOLT_FAKE_VOLT=bench). Main prints "bench:fake-volt"
// as it starts and "bench:sent N" as reports go out; without the first, the app is closed at once,
// before anything else could happen. Its profile is a throwaway one, with this computer's mix seeded.
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { closeBrowser, connect, findTarget, wait } from "../lib/cdp.mjs";
import { benchSerial, seededMix } from "./volt-config.mjs";

const port = 9343;

const launch = (desktopDir, profile, extra) => {
    const electron = path.join(desktopDir, "node_modules", "electron", "dist", "electron.exe");
    // Covered by other windows, Windows would count it occluded and Chromium would stop drawing it.
    const args = [
        ".",
        `--user-data-dir=${profile}`,
        `--remote-debugging-port=${port}`,
        "--disable-features=CalculateNativeWinOcclusion",
    ];
    return spawn(electron, [...args, ...extra], {
        cwd: desktopDir,
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, VOLT_FAKE_VOLT: "bench" },
    });
};

/** What main says on its standard output: whether the fake is in use, and how many reports it was sent. */
const follow = (child) => {
    const heard = { isFake: false, sent: 0 };
    let buffer = "";
    child.stdout.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            if (line.trim() === "bench:fake-volt") heard.isFake = true;
            const sent = line.match(/^bench:sent (\d+)/);
            if (sent) heard.sent = Number(sent[1]);
        }
    });
    return heard;
};

const waitUntil = async (isDone, ms, what) => {
    for (const start = performance.now(); performance.now() - start < ms; await wait(100)) if (isDone()) return;
    throw new Error(`${what} didn't happen within ${ms / 1000} s.`);
};

/** A profile with the app's own store already there: the mix for the fake Volt, and nothing to hand over. */
const makeProfile = (settings) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "volt-bench-app-"));
    fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify(settings));
    const store = { mixes: { [benchSerial]: seededMix() }, brightness: {}, pendingMix: null, view: {}, trayHidden: [] };
    fs.writeFileSync(path.join(profile, "volt-mixer.json"), JSON.stringify(store));
    return profile;
};

/**
 * Starts the app (`extra`: its arguments), waits until it has put its mix on the fake Volt, and
 * calls `run` with the main window's DevTools connection (null when no window is open), the
 * processes to measure, and how many reports have been sent.
 */
export const withDesktop = async (desktopDir, extra, settings, run) => {
    const profile = makeProfile(settings);
    const child = launch(desktopDir, profile, extra);
    try {
        const heard = follow(child);
        await waitUntil(() => heard.isFake, 8000, "The app saying it uses the pretend Volt");
        await waitUntil(() => heard.sent >= 96, 15_000, "The mix going on the pretend Volt");
        await wait(3000);
        const isWindowed = !extra.includes("--hidden");
        const target = isWindowed
            ? await findTarget(port, (t) => t.type === "page" && t.url === "app://volt/", child)
            : null;
        const cdp = target ? await connect(target.webSocketDebuggerUrl) : null;
        if (cdp) await cdp.send("Performance.enable");
        return await run(cdp, { root: child.pid }, async () => heard.sent);
    } finally {
        await closeBrowser(child, profile);
    }
};
