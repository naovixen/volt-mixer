// A stand-in Volt for perf-bench.mjs, installed in the page before any of its scripts run. It
// replaces navigator.hid (the bench starts the browser with WebHID switched off, so the real device
// is out of reach), answers identify and the state request with the bytes perf-bench.mjs built from
// src/data, sends meter reports 50 times a second, and counts what the page sends.
// __voltBenchConfig is set just before this script by perf-bench.mjs.
(() => {
    const config = globalThis.__voltBenchConfig;
    const stats = { sent: 0, meterReports: 0, byCommand: {} };
    globalThis.__voltBench = stats;

    const device = new EventTarget();
    Object.assign(device, {
        vendorId: config.vendorId,
        productId: config.productId,
        productName: "Volt 4 (bench)",
        opened: false,
        collections: [
            {
                usagePage: config.controlUsagePage,
                outputReports: [{ reportId: config.commandId }],
                inputReports: [],
                children: [],
            },
        ],
    });

    const input = (reportId, bytes) => {
        const data = new Uint8Array(config.inputBytes);
        data.set(bytes);
        const event = Object.assign(new Event("inputreport"), { device, reportId, data: new DataView(data.buffer) });
        device.dispatchEvent(event);
    };

    /* Meter levels that move like a voice on Input 1, a quieter one on Input 2, and music on the monitor. */
    const meterBytes = (time) => {
        const bytes = new Uint8Array(config.inputBytes);
        for (const [name, offset] of Object.entries(config.meterOffsets)) {
            const wave = Math.abs(Math.sin(time / (name.startsWith("monitor") ? 180 : 420) + offset));
            const level = Math.round(config.meterLevels[name] * (0.4 + 0.6 * wave));
            bytes[offset - 1] = level & 0xff;
            bytes[offset] = level >> 8;
        }
        return bytes;
    };

    /*
     * A real Volt's reports arrive as events, which a hidden page doesn't slow down, but its timers
     * it does. So replies go through a message channel (a task, not a timer), and the meters' clock
     * runs in a worker where the page allows one (the desktop app's CSP doesn't, but it doesn't
     * throttle either).
     */
    const soon = new MessageChannel();
    const replies = [];
    soon.port1.onmessage = () => replies.shift()?.();
    const reply = (run) => (replies.push(run), soon.port2.postMessage(0));

    const meterTick = () => {
        if (!device.opened) return;
        stats.meterReports += 1;
        input(config.metersId, meterBytes(performance.now()));
    };
    /* A CSP that blocks the worker says so with an error event, not an exception. */
    const startMeterClock = () => {
        const fallBack = () => setInterval(meterTick, 20);
        try {
            const source = "setInterval(() => postMessage(0), 20);";
            const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
            worker.onmessage = meterTick;
            worker.onerror = fallBack;
        } catch {
            fallBack();
        }
    };
    let isClockRunning = false;
    device.open = async () => {
        device.opened = true;
        if (!isClockRunning) startMeterClock();
        isClockRunning = true;
    };
    device.close = async () => {
        device.opened = false;
    };
    device.sendReport = async (reportId, data) => {
        stats.sent += 1;
        const bytes = new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength ?? data.length);
        const key = `${reportId}:${bytes[0]}`;
        stats.byCommand[key] = (stats.byCommand[key] ?? 0) + 1;
        if (reportId === config.identifyId) reply(() => input(config.identifyReplyId, config.identifyReply));
        if (reportId === config.commandId && bytes[0] === config.stateRequestCmd)
            reply(() => input(config.commandId, config.stateDump));
    };

    const hid = new EventTarget();
    hid.getDevices = async () => [device];
    hid.requestDevice = async () => [device];
    Object.defineProperty(Navigator.prototype, "hid", { get: () => hid, configurable: true });
})();
