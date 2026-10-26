import type http from "http";
import os from "os";
import { homeAddresses, type IPhoneAddress } from "./phone-rules.ts";
import { closeServer, listenOn, phonePort } from "./phone-server.ts";
import { endStreams, streamCount, toStreams, watchStreamCount } from "./phone-streams.ts";
import { currentToken, rotateToken } from "./phone-token.ts";
import { loadSettings } from "./settings.ts";
import { getMainWindow } from "./windows.ts";

/*
 * The phone remote: the tray page served on the home network while Settings › Desktop app ›
 * Phone remote is on (phone-server.ts). It answers only on the address it was set up on, so a
 * laptop that starts at login on someone else's Wi-Fi stays off. reconcilePhoneRemote brings the
 * server in line with the settings and the network, on a settings change, on waking and every
 * few seconds while it's on; it restarts the server only when the address to serve on changes.
 * Settings hears every change of state (phone:status), so it never has to ask.
 */

const networkCheckMs = 10_000;
const keepAliveMs = 20_000;
let server: http.Server | null = null;
let boundAddress = "";
let problem = "";
let networkCheck: NodeJS.Timeout | undefined;
let keepAlive: NodeJS.Timeout | undefined;
let reconciling = Promise.resolve();
let lastTold = "";

const addresses = (): IPhoneAddress[] => homeAddresses(os.networkInterfaces());
const isServing = (): boolean => server?.listening === true;

/** What Settings shows: the address, the link for the QR code, and how many phones are connected. */
export const phoneInfo = () => ({
    isRunning: isServing(),
    address: loadSettings().phoneAddress,
    addresses: addresses(),
    link: isServing() ? `http://${boundAddress}:${phonePort}/tray/#t=${currentToken()}` : "",
    error: problem,
    phones: streamCount(),
});

/** The main window hears the remote's state when it changes. A phone that connects is sent what the tray shows. */
const tellPage = (): void => {
    const info = phoneInfo();
    const told = JSON.stringify(info);
    if (told === lastTold) return;
    lastTold = told;
    getMainWindow()?.webContents.send("phone:status", info);
};

let onPhoneJoined = (): void => {};

export const whenPhoneJoins = (listen: () => void): void => {
    onPhoneJoined = listen;
};

let phonesBefore = 0;
watchStreamCount((count) => {
    if (count > phonesBefore) onPhoneJoined();
    phonesBefore = count;
    tellPage();
});

/** Tells the main window again, as its page has (re)loaded and knows nothing yet. */
export const tellPhoneStatus = (): void => {
    lastTold = "";
    tellPage();
};

/** The address to serve on now, or why there's none. */
const wanted = (): { address: string; problem: string } => {
    const { phoneRemote, phoneAddress } = loadSettings();
    const here = addresses();
    if (!phoneRemote) return { address: "", problem: "" };
    if (here.some((entry) => entry.address === phoneAddress)) return { address: phoneAddress, problem: "" };
    if (here.length === 0) return { address: "", problem: "This computer isn't on a home network." };
    if (!phoneAddress) return { address: "", problem: "Choose the address your phone can reach." };
    return {
        address: "",
        problem: `This computer isn't on the network Phone remote was set up on (${phoneAddress}). Choose an address to use this one.`,
    };
};

const stopServer = async (): Promise<void> => {
    const closing = server;
    server = null;
    boundAddress = "";
    clearInterval(keepAlive);
    endStreams();
    if (closing) await closeServer(closing);
};

const startServer = async (address: string): Promise<void> => {
    try {
        server = await listenOn(address);
        boundAddress = address;
        keepAlive = setInterval(() => toStreams(""), keepAliveMs);
    } catch (error) {
        const isPortTaken = (error as NodeJS.ErrnoException).code === "EADDRINUSE";
        problem = isPortTaken ? `Port ${phonePort} is in use by another program.` : "The phone remote couldn't start.";
    }
};

const watchNetwork = (isOn: boolean): void => {
    if (isOn && !networkCheck) networkCheck = setInterval(() => void reconcilePhoneRemote(), networkCheckMs);
    if (isOn) return;
    clearInterval(networkCheck);
    networkCheck = undefined;
};

const reconcileNow = async (): Promise<void> => {
    const goal = wanted();
    if (!isServing() || boundAddress !== goal.address) {
        await stopServer();
        problem = goal.problem;
        if (goal.address) await startServer(goal.address);
    }
    watchNetwork(loadSettings().phoneRemote);
    tellPage();
};

/** Starts, moves or stops the phone remote to match the settings and the network; one at a time. */
export const reconcilePhoneRemote = (): Promise<void> =>
    (reconciling = reconciling.then(reconcileNow).catch(() => undefined));

/** As the app quits. */
export const stopPhoneRemote = (): void => {
    watchNetwork(false);
    void stopServer();
};

/** A new pairing code: every phone paired with the old one is let go and has to scan again. */
export const rotatePhoneToken = (): void => {
    rotateToken();
    endStreams();
    tellPage();
};

/**
 * Where turning the remote on sets it up: the address it has, if this computer is on it, or
 * else the best one here. The user is at the computer, choosing this network.
 */
export const setUpAddress = (saved: string): string => {
    const here = addresses();
    return here.some((entry) => entry.address === saved) ? saved : (here[0]?.address ?? saved);
};
