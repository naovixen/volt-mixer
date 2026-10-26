// Measures Volt Mixer's CPU and memory against a fake Volt (perf/fake-volt.js), so it never
// reaches the real one: the website in headless Edge or Chrome, and the desktop app run from
// source with a throwaway profile. Optionally samples the installed app as it is running now.
// Windows only (it reads Windows' process counters). Build first:
//   pnpm build                    (the website, served here with astro preview)
//   cd desktop && pnpm build      (the desktop app)
// then, in tools/:
//   node perf-bench.mjs <label> [web] [desktop] [installed]     all three when none is named
// Results go to perf/results/<label>.json and are printed as a Markdown table.
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { findBrowser, quietBrowserArgs } from "./lib/browser.mjs";
import { closeBrowser, connect, evaluate, findTarget, wait } from "./lib/cdp.mjs";
import { compareSamples, sampleProcesses } from "./perf/processes.mjs";
import { dragFader, measure, waitForLive } from "./perf/scenarios.mjs";
import { benchSerial, fakeVoltConfig, seededMix } from "./perf/volt-config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const desktopDir = path.join(root, "desktop");
const [label = "run", ...wanted] = process.argv.slice(2);
const parts = wanted.length > 0 ? wanted : ["web", "desktop", "installed"];
const previewPort = 4329;
const idleSeconds = 15;
const dragSeconds = 6;

/** The fake Volt and this computer's saved mix, set up before any of the page's own scripts run. */
const pageSetup = () =>
    [
        `globalThis.__voltBenchConfig = ${JSON.stringify(fakeVoltConfig())};`,
        fs.readFileSync(path.join(here, "perf", "fake-volt.js"), "utf8"),
        `try { localStorage.setItem("volt-mixer.mix.${benchSerial}", ${JSON.stringify(JSON.stringify(seededMix()))}); } catch {}`,
    ].join("\n");

/** The page must not have WebHID of its own: only then can it be given the fake, and nothing else. */
const assertNoWebHid = async (cdp) => {
    if (await evaluate(cdp, `"hid" in navigator && !globalThis.__voltBench`))
        throw new Error("The page has real WebHID: stopping before it can reach a Volt.");
};

const usePage = async (cdp, load) => {
    await cdp.send("Page.enable");
    await cdp.send("Performance.enable");
    await assertNoWebHid(cdp);
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: pageSetup() });
    await Promise.all([cdp.once("Page.loadEventFired"), load()]);
    await waitForLive(cdp);
};

const startPreview = async () => {
    const astro = path.join(root, "node_modules", "astro", "bin", "astro.mjs");
    const args = [astro, "preview", "--port", String(previewPort), "--host", "127.0.0.1"];
    const server = spawn(process.execPath, args, { cwd: root, stdio: "ignore" });
    const url = `http://127.0.0.1:${previewPort}/volt-mixer/`;
    for (let tries = 0; tries < 100; tries += 1) {
        if ((await fetch(url).catch(() => null))?.ok) return { server, url };
        await wait(200);
    }
    server.kill();
    throw new Error("astro preview didn't start: run pnpm build first.");
};

const setHidden = async (cdp, targetId, isHidden) => {
    const { windowId } = await cdp.send("Browser.getWindowForTarget", { targetId });
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: isHidden ? "minimized" : "normal" } });
};

const webScenarios = async (cdp, target, processes) => {
    const context = { cdp, processes };
    const results = [await measure(context, "idle", idleSeconds)];
    results.push(await measure(context, "drag", dragSeconds, dragFader(cdp, dragSeconds)));
    await setHidden(cdp, target.id, true);
    await wait(1000);
    const hidden = await measure(context, "hidden", idleSeconds);
    results.push({ ...hidden, visibility: await evaluate(cdp, "document.visibilityState") });
    results.push(
        await measure(context, "shown again (3 s)", 3, () => setHidden(cdp, target.id, false).then(() => wait(3000))),
    );
    return results;
};

const runWeb = async () => {
    const { server, url } = await startPreview();
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "volt-bench-web-"));
    const args = ["--headless", "--remote-debugging-port=9342", `--user-data-dir=${profile}`, ...quietBrowserArgs];
    const child = spawn(
        findBrowser(),
        [...args, "--disable-blink-features=WebHID", "--window-size=1240,900", "about:blank"],
        {
            stdio: "ignore",
        },
    );
    try {
        const target = await findTarget(9342, (t) => t.type === "page" && t.url === "about:blank", child);
        const cdp = await connect(target.webSocketDebuggerUrl);
        await usePage(cdp, () => cdp.send("Page.navigate", { url }));
        return await webScenarios(cdp, target, { root: child.pid });
    } finally {
        await closeBrowser(child, profile);
        server.kill();
    }
};

/** The desktop app from source, with its own profile, so the installed app's data stays untouched. */
const launchDesktop = (profile, port, extra = []) => {
    const electron = path.join(desktopDir, "node_modules", "electron", "dist", "electron.exe");
    // Covered by other windows, Windows would count it occluded and Chromium would stop drawing it.
    const args = [
        ".",
        `--user-data-dir=${profile}`,
        `--remote-debugging-port=${port}`,
        "--disable-blink-features=WebHID",
        "--disable-features=CalculateNativeWinOcclusion",
    ];
    return spawn(electron, [...args, ...extra], {
        cwd: desktopDir,
        stdio: "ignore",
        env: { ...process.env, VOLT_FAKE_VOLT: "bench" },
    });
};

const isMainPage = (target) =>
    target.type === "page" && target.url.startsWith("app://volt/") && !target.url.includes("/tray/");

const withDesktop = async (extra, settings, run) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "volt-bench-app-"));
    fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify(settings));
    const child = launchDesktop(profile, 9343, extra);
    try {
        const target = await findTarget(9343, isMainPage, child);
        const cdp = await connect(target.webSocketDebuggerUrl);
        await usePage(cdp, () => cdp.send("Page.reload"));
        return await run(cdp, { root: child.pid });
    } finally {
        await closeBrowser(child, profile);
    }
};

const runDesktop = async () => {
    const shown = await withDesktop([], {}, async (cdp, processes) => [
        await measure({ cdp, processes }, "window open, idle", idleSeconds),
        await measure({ cdp, processes }, "window open, drag", dragSeconds, dragFader(cdp, dragSeconds)),
    ]);
    const tray = await withDesktop(["--hidden"], { loginStart: "tray" }, async (cdp, processes) => [
        await measure({ cdp, processes }, "in the tray", idleSeconds),
    ]);
    return [...shown, ...tray];
};

/** The installed app as it is now (whatever it's doing): only read, never touched. */
const runInstalled = async () => {
    const processes = { name: "Volt Mixer.exe" };
    const before = sampleProcesses(processes);
    if (before.rows.length === 0) return [{ scenario: "installed app", note: "not running" }];
    await wait(30_000);
    return [{ scenario: "installed app, as running (30 s)", ...compareSamples(before, sampleProcesses(processes)) }];
};

const columns = [
    "scenario",
    "processes",
    "privateSetMB",
    "privateBytesMB",
    "cpuPercentMachine",
    "cpuPercentOneCore",
    "pageTaskMsPerS",
    "pageScriptMsPerS",
    "layoutsPerS",
    "styleRecalcsPerS",
    "jsHeapMB",
    "hidWritesPerS",
];

const table = (title, rows) => {
    const cell = (row, column) => String(row[column] ?? "");
    const lines = [`### ${title}`, "", `| ${columns.join(" | ")} |`, `|${columns.map(() => " --- ").join("|")}|`];
    return [...lines, ...rows.map((row) => `| ${columns.map((column) => cell(row, column)).join(" | ")} |`)].join("\n");
};

const runners = { web: runWeb, desktop: runDesktop, installed: runInstalled };
const resultsFile = path.join(here, "perf", "results", `${label}.json`);
/* A part run again replaces only its own results under the same label. */
const earlier = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, "utf8")) : {};
const results = {
    ...earlier,
    label,
    at: new Date().toISOString(),
    cores: os.availableParallelism(),
    cpu: os.cpus()[0]?.model,
};
for (const part of parts) {
    console.error(`Measuring ${part}…`);
    results[part] = await runners[part]();
}
fs.mkdirSync(path.join(here, "perf", "results"), { recursive: true });
fs.writeFileSync(path.join(here, "perf", "results", `${label}.json`), `${JSON.stringify(results, null, 4)}\n`);
for (const part of parts) console.log(`${table(`${label}: ${part}`, results[part])}\n`);
