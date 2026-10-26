// What the bench does to a mixer page while it measures: leave it alone, drag a fader, hide it and
// show it again. Each scenario reports the page's own work (DevTools' Performance metrics), the
// processes' CPU and memory, and how many reports the page sent the (fake) Volt.
import { evaluate, wait } from "../lib/cdp.mjs";
import { compareSamples, sampleProcesses } from "./processes.mjs";

const pageMetricNames = [
    "TaskDuration",
    "ScriptDuration",
    "LayoutDuration",
    "RecalcStyleDuration",
    "LayoutCount",
    "RecalcStyleCount",
    "JSHeapUsedSize",
];

const pageMetrics = async (cdp) => {
    if (!cdp) return null;
    const { metrics } = await cdp.send("Performance.getMetrics");
    return Object.fromEntries(metrics.filter((m) => pageMetricNames.includes(m.name)).map((m) => [m.name, m.value]));
};

const sentCount = async (cdp) => (cdp ? ((await evaluate(cdp, "globalThis.__voltBench?.sent ?? 0")) ?? 0) : 0);
const sentByCommand = async (cdp) =>
    cdp ? ((await evaluate(cdp, "globalThis.__voltBench?.byCommand ?? {}")) ?? {}) : {};

/** What was sent in between, by report ID and command byte ("240:1" is a crosspoint). */
const commandDelta = (before, after) =>
    Object.fromEntries(
        Object.entries(after)
            .map(([key, count]) => [key, count - (before[key] ?? 0)])
            .filter(([, count]) => count > 0),
    );

/** Per second over the scenario: page work in ms, layouts and style recalcs, reports sent. */
const comparePage = (before, after, seconds) => {
    if (!before || !after) return {};
    const rate = (name, scale = 1) => +(((after[name] - before[name]) * scale) / seconds).toFixed(1);
    return {
        pageTaskMsPerS: rate("TaskDuration", 1000),
        pageScriptMsPerS: rate("ScriptDuration", 1000),
        layoutsPerS: rate("LayoutCount"),
        styleRecalcsPerS: rate("RecalcStyleCount"),
        jsHeapMB: +(after.JSHeapUsedSize / 1024 / 1024).toFixed(1),
    };
};

/** Runs `act` (or just waits) for `seconds` and measures it. */
export const measure = async (
    { cdp, processes, sent = sentCount },
    name,
    seconds,
    act = () => wait(seconds * 1000),
) => {
    const before = {
        page: await pageMetrics(cdp),
        sent: await sent(cdp),
        byCommand: await sentByCommand(cdp),
        procs: sampleProcesses(processes),
    };
    const started = performance.now();
    await act();
    const elapsed = (performance.now() - started) / 1000;
    const after = {
        page: await pageMetrics(cdp),
        sent: await sent(cdp),
        byCommand: await sentByCommand(cdp),
        procs: sampleProcesses(processes),
    };
    return {
        scenario: name,
        ...compareSamples(before.procs, after.procs),
        ...comparePage(before.page, after.page, elapsed),
        hidWritesPerS: +((after.sent - before.sent) / elapsed).toFixed(1),
        hidWrites: commandDelta(before.byCommand, after.byCommand),
    };
};

const thumbCentre = (cdp) =>
    evaluate(
        cdp,
        `(() => {
            const fader = document.querySelector("[data-strips] [data-slider]");
            fader.scrollIntoView({ block: "center" });
            const rect = fader.querySelector(".thumb").getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`,
    );

const mouse = (cdp, type, x, y) =>
    cdp.send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        buttons: type === "mouseReleased" ? 0 : 1,
        clickCount: 1,
    });

/**
 * Drags Input 1's fader up and down for `seconds`, with a pointer move every `everyMs` (4 ms is a
 * 240 Hz mouse). Moves are sent without waiting for each to be handled, as a mouse doesn't wait;
 * the browser groups them per frame, as it does for a real one.
 */
export const dragFader =
    (cdp, seconds, everyMs = 4) =>
    async () => {
        const { x, y } = await thumbCentre(cdp);
        await mouse(cdp, "mousePressed", x, y);
        const moves = [];
        const start = performance.now();
        for (let now = start; now - start < seconds * 1000; now = performance.now()) {
            const offset = Math.sin(((now - start) / 1000) * Math.PI * 2) * 60;
            moves.push(mouse(cdp, "mouseMoved", x, y + offset));
            await wait(everyMs);
        }
        await Promise.all(moves);
        await mouse(cdp, "mouseReleased", x, y);
    };

/** Waits until the page has put its mix on the fake Volt (crosspoints sent), then lets it settle. */
export const waitForLive = async (cdp, settleMs = 3000) => {
    const crosspoints = `Object.entries(globalThis.__voltBench?.byCommand ?? {}).some(([key]) => key.endsWith(":1"))`;
    for (let tries = 0; tries < 100; tries += 1) {
        if (await evaluate(cdp, crosspoints)) return wait(settleMs);
        await wait(200);
    }
    throw new Error("The page never connected to the fake Volt.");
};
