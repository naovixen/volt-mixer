// Guided prompts for hardware-only actions during a capture. Each step waits for you to press
// Enter when you've done it (no time limit). Steps are logged with timestamps in the same format
// as capture-run.js so decode-capture.js can label the traffic.
//   node manual-prompts.js [startStep]
"use strict";
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const LOG = path.resolve(
    __dirname,
    "..",
    "captures",
    `manual-log-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
);

// Every action leaves the Volt as it was (toggle twice, turn down then back up).
const PROMPTS = [
    ["monitor mute (knob press)", "Press the KNOB once (mute monitors), then press it again (unmute)."],
    ["select headphones", "Press the MONITOR/HEADPHONE button once (amber = headphones)."],
    ["headphone knob", "Turn the KNOB down 3 clicks, then back up 3 clicks."],
    ["headphone mute (knob press)", "Press the KNOB once (mute headphones), then press it again (unmute)."],
    ["select monitor", "Press the MONITOR/HEADPHONE button again (back to green = monitors)."],
    [
        "console monitor level (full range)",
        "In UAD Console: MUTE the monitor, drag the MONITOR level (right column) fully UP to the very top, then back down to 0, then unmute. Muted so it stays silent; this captures the whole range, not just the bottom. Never leave it above 0.",
    ],
    [
        "console headphone level (full range)",
        "In UAD Console: MUTE the headphones, drag the HEADPHONE level fully UP to the very top, then back down to 0, then unmute.",
    ],
    ["select input 1", "Press INPUT until the display shows input 1."],
    [
        "tone button",
        "Press TONE 4 times: it steps through all four tone modes and lands back where it started, whatever the starting mode.",
    ],
    ["direct button", "Press DIRECT twice (toggle and back)."],
    ["48v button", "Nothing plugged into XLR 1? Press 48V twice (on, then off). Otherwise just press Enter to skip."],
    ["gain knob", "Turn the KNOB up 2 clicks, then down 2 clicks (input 1 gain)."],
    ["select line 3", "Press INPUT until the display shows input 3."],
    [
        "link 3-4 (hold input)",
        "With input 3 or 4 selected, press and HOLD the INPUT button (not the knob) to toggle the 3-4 link, then press and HOLD INPUT again to toggle it back. It returns to the state it started in, linked or not.",
    ],
    [
        "meter view",
        "Press and HOLD the KNOB for the menu, choose Meter View. Then open the menu again and choose Input View.",
    ],
    ["console identify", "In UAD Console: Settings > Identify."],
    [
        "console hp source",
        "In UAD Console CUES window: click the empty space under CUE 2 (headphones to Cue 2), then under CUE 1 (back).",
    ],
    ["console cue2 mix", "In UAD Console CUES window: toggle the MIX button on Cue 2 off, then on again."],
];

const log = (e) =>
    fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), iso: new Date().toISOString(), ...e }) + "\n");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The live monitor level from UA's API while the user sets the knob (the API mirrors the hardware
// knob), or null when the API isn't available and only the instructions are shown.
const connectMonitor = async () => {
    try {
        const ua = require("./lib/ua-api");
        const client = await ua.connect();
        const dev = await ua.findVolt(client);
        return { client, path: (await ua.buses(client, dev)).MONITOR + "/outputs/main/controls/gain" };
    } catch {
        return null;
    }
};

// One read at a time until Enter, so slow replies can't pile up.
const showLevelUntil = async (monitor, isDone) => {
    while (!isDone()) {
        const level = await monitor.client.getValue(monitor.path).catch(() => "?");
        const text = typeof level === "number" ? level.toFixed(1) : level;
        process.stdout.write(`\r  Monitor level: ${text}   (press Enter when ready)   `);
        await sleep(300);
    }
};

const printSetup = (hasMonitor) => {
    console.log(
        "\nSETUP: press MONITOR/HEADPHONE until it is GREEN, and make sure the display is in Input View (not Meter View).",
    );
    if (!hasMonitor) return process.stdout.write("  Press Enter when ready > ");
    console.log('"Monitor level" below should show 0 (your setting). If it does, leave the knob alone.');
    console.log(
        "If not: turn the KNOB DOWN slowly and STOP as soon as it shows 0. Turning past 0 makes the Volt jump to loud.",
    );
};

const setupStep = async () => {
    const monitor = await connectMonitor();
    printSetup(Boolean(monitor));
    let isReady = false;
    const showing = monitor ? showLevelUntil(monitor, () => isReady) : Promise.resolve();
    await new Promise((resolve) => rl.once("line", resolve));
    isReady = true;
    await showing;
    monitor?.client.close();
};

const runPrompts = async (start) => {
    for (let i = start; i < PROMPTS.length; i++) {
        const [label, text] = PROMPTS[i];
        log({ step: "set", label, prompt: text });
        const answer = await ask(`\n[${i + 1}/${PROMPTS.length}] ${text}\n  Press Enter when done > `);
        log({ step: "done", label, skipped: answer.trim().toLowerCase() === "s" });
        // Short gap so the last action's traffic isn't attributed to the next step.
        await sleep(1500);
        log({ step: "set", label: "idle" });
    }
};

const main = async () => {
    await setupStep();
    console.log(`\n${PROMPTS.length} steps. Do each one, then press Enter. Type "s" + Enter to skip a step.\n`);
    log({ step: "set", label: "idle" });
    await sleep(3000);
    await runPrompts(Math.max(1, +(process.argv[2] || 1)) - 1);
    log({ phase: "done" });
    rl.close();
    console.log(`\nAll done, thank you. You can close this window. Log: ${LOG}`);
};

main();
