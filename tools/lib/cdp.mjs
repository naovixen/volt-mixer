// A minimal DevTools protocol client for the tools that drive Edge, Chrome or Electron headless or
// from source (guide-images.mjs, perf-bench.mjs): send a command, wait for an event, evaluate.
import fs from "fs";

const cdpTimeoutMs = 30000;

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rejects if `promise` takes longer than `ms`, so a browser that hangs can't stall the run. */
export const timeBox = (promise, what, ms = cdpTimeoutMs) => {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s.`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/** The first target the DevTools port lists that `isWanted` accepts, once there is one. */
export const findTarget = async (port, isWanted, child, tries = 100) => {
    for (let attempt = 0; attempt < tries && child.exitCode === null; attempt += 1) {
        try {
            const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
            const target = targets.find(isWanted);
            if (target) return target;
        } catch {
            /* Not listening yet. */
        }
        await wait(200);
    }
    throw new Error("The browser didn't start, or never showed the page.");
};

/* Answers a command's call, or resolves whoever waits for an event. */
const onMessage =
    (pending, waiters) =>
    ({ data }) => {
        const message = JSON.parse(data);
        const call = pending.get(message.id);
        pending.delete(message.id);
        if (call) return message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
        for (const waiter of [...waiters].filter((candidate) => candidate.method === message.method)) {
            waiters.delete(waiter);
            waiter.resolve(message.params);
        }
    };

/* Both commands and waits are time-boxed, and both fail at once if the connection closes. */
const createCdp = (socket) => {
    const pending = new Map();
    const waiters = new Set();
    let lastId = 0;
    const failAll = (error) => [...pending.values(), ...waiters].forEach((call) => call.reject(error));
    socket.onclose = () => failAll(new Error("The browser closed the DevTools connection."));
    socket.onerror = () => failAll(new Error("The DevTools connection failed."));
    socket.onmessage = onMessage(pending, waiters);
    const send = (method, params = {}) => {
        lastId += 1;
        const id = lastId;
        const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
        socket.send(JSON.stringify({ id, method, params }));
        return timeBox(result, method).finally(() => pending.delete(id));
    };
    const once = (method) => {
        const waiter = { method };
        const event = new Promise((resolve, reject) => Object.assign(waiter, { resolve, reject }));
        waiters.add(waiter);
        return timeBox(event, `Waiting for ${method}`).finally(() => waiters.delete(waiter));
    };
    return { send, once, close: () => socket.close() };
};

export const connect = (socketUrl) => {
    const socket = new WebSocket(socketUrl);
    const opened = new Promise((resolve, reject) => {
        socket.onopen = () => resolve(createCdp(socket));
        socket.onerror = () => reject(new Error("Couldn't connect to the browser's DevTools."));
    });
    return timeBox(opened, "Connecting to the browser");
};

export const evaluate = async (cdp, expression) => {
    const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
};

/** Ends a browser started by a tool and removes its throwaway profile. */
export const closeBrowser = async (child, profile) => {
    const exited = new Promise((resolve) => (child.exitCode === null ? child.once("exit", resolve) : resolve()));
    child.kill();
    await timeBox(exited, "Closing the browser", 5000).catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
};
