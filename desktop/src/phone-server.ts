import http from "http";
import { header, readText, send } from "./http-helpers.ts";
import { isSignedBy, issueChallenge, takeChallenge, type ISignedRequest } from "./phone-auth.ts";
import { refusalFor } from "./phone-rules.ts";
import { addStream, latestLine, streamNonce, takeSeq } from "./phone-streams.ts";
import { currentToken } from "./phone-token.ts";
import { csp, readSiteFile } from "./site-files.ts";

/*
 * The phone remote's server: the tray page's own files and its API, on one private address. The
 * Host must be that address (against DNS rebinding), and every API request but the challenge is
 * signed (phone-auth.ts). It's plain HTTP: someone watching the home network could see the mix,
 * but can't change it.
 *
 *   GET  /api/challenge  { nonce }: one to sign, good once for 10 s
 *   GET  /api/events     signed with a challenge, seq 0: one JSON line per change, blank keep-alives
 *   POST /api/intent     the intent as JSON, signed with the stream's challenge and a rising seq → { result }
 *
 * Signed requests carry X-Volt-Client, X-Volt-Seq and X-Volt-Signature; opening a stream adds X-Volt-Nonce.
 */

export const phonePort = 48190;
const maxBodyBytes = 4096;
const requestsPerSecond = 50;
const clientName = /^[\w-]{1,40}$/;
const securityHeaders = {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
};
const pageFiles = new Set(["/tray/", "/theme.js", "/icon.svg", "/apple-touch-icon.png", "/icon-192.png"]);
const rates = new Map<string, { second: number; count: number }>();
/** Applies a phone's change: the engine host's, set by main.ts (answerPhoneIntents). */
let runIntent = (_intent: unknown): unknown => "ignored";

export const answerPhoneIntents = (run: (intent: unknown) => unknown): void => {
    runIntent = run;
};

const remoteIp = (req: http.IncomingMessage): string => req.socket.remoteAddress?.replace(/^::ffff:/, "") ?? "";

/** Counted per address: the client name is the phone's own choice. */
const isWithinRate = (address: string): boolean => {
    const second = Math.floor(Date.now() / 1000);
    const rate = rates.get(address);
    const count = rate?.second === second ? rate.count + 1 : 1;
    if (rates.size > 64) rates.clear();
    rates.set(address, { second, count });
    return count <= requestsPerSecond;
};

const serveFile = async (res: http.ServerResponse, pathname: string): Promise<void> => {
    if (pathname === "/") return send(res, 302, { Location: "/tray/" });
    const isPageFile = pageFiles.has(pathname) || pathname.startsWith("/_astro/");
    const file = isPageFile ? await readSiteFile(pathname) : null;
    if (!file) return send(res, 404, securityHeaders);
    res.writeHead(200, { ...securityHeaders, "Content-Type": file.type, "Cache-Control": "no-cache" });
    res.end(file.body);
};

/** What the request says it is, for checking its signature; null when it's malformed. */
const signedFacts = (req: http.IncomingMessage, nonce: string, body: string): ISignedRequest | null => {
    const client = header(req, "x-volt-client");
    const seq = Number(header(req, "x-volt-seq") || Number.NaN);
    if (!clientName.test(client) || !Number.isSafeInteger(seq) || seq < 0) return null;
    const path = new URL(req.url ?? "/", "http://phone").pathname;
    return { method: req.method ?? "", path, client, seq, nonce, body };
};

const isSigned = (req: http.IncomingMessage, facts: ISignedRequest): boolean =>
    isSignedBy(currentToken(), facts, header(req, "x-volt-signature"));

/** A stream is opened by signing a fresh challenge; each challenge opens one stream, once. */
const openEvents = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const facts = signedFacts(req, header(req, "x-volt-nonce"), "");
    if (!facts || facts.seq !== 0) return send(res, 400, securityHeaders);
    if (!isSigned(req, facts)) return send(res, 401, securityHeaders);
    if (!takeChallenge(facts.nonce)) return send(res, 409, securityHeaders);
    if (!addStream(facts.client, facts.nonce, res)) return send(res, 503, securityHeaders);
    res.writeHead(200, { ...securityHeaders, "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
    res.flushHeaders();
    const latest = latestLine();
    if (latest) res.write(`${latest}\n`);
};

const parsed = (text: string): unknown => {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return null;
    }
};

/** One change from a phone with an open stream. Its seq only grows, so a late or repeated one is dropped. */
const takeIntent = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    if (!req.headers["content-type"]?.startsWith("application/json")) return send(res, 415, securityHeaders);
    const body = await readText(req, maxBodyBytes);
    const nonce = streamNonce(header(req, "x-volt-client"));
    const facts = body === null ? null : signedFacts(req, nonce ?? "", body);
    if (!facts) return send(res, 400, securityHeaders);
    if (!nonce) return send(res, 409, securityHeaders);
    if (!isSigned(req, facts)) return send(res, 401, securityHeaders);
    if (!takeSeq(facts.client, facts.seq)) return send(res, 200, securityHeaders, { result: "stale" });
    send(res, 200, securityHeaders, { result: runIntent(parsed(facts.body)) });
};

const handle = async (req: http.IncomingMessage, res: http.ServerResponse, served: string): Promise<void> => {
    const refused = refusalFor({ host: req.headers.host, origin: req.headers.origin, remoteIp: remoteIp(req) }, served);
    if (refused) return send(res, refused, securityHeaders);
    const { pathname } = new URL(req.url ?? "/", `http://${served}`);
    if (!pathname.startsWith("/api/"))
        return req.method === "GET" ? serveFile(res, pathname) : send(res, 405, securityHeaders);
    if (!isWithinRate(remoteIp(req))) return send(res, 429, securityHeaders);
    const route = `${req.method} ${pathname}`;
    if (route === "GET /api/challenge") return send(res, 200, securityHeaders, { nonce: issueChallenge() });
    if (route === "GET /api/events") return openEvents(req, res);
    if (route === "POST /api/intent") return takeIntent(req, res);
    send(res, 404, securityHeaders);
};

/** A server for phones on `address`, once it's listening; rejects with why it can't (EADDRINUSE). */
export const listenOn = (address: string): Promise<http.Server> =>
    new Promise((resolve, reject) => {
        const served = `${address}:${phonePort}`;
        const server = http.createServer((req, res) => {
            void handle(req, res, served).catch(() => (res.headersSent ? res.destroy() : send(res, 500)));
        });
        Object.assign(server, { headersTimeout: 10_000, requestTimeout: 10_000, maxConnections: 16 });
        server.once("error", reject);
        server.listen(phonePort, address, () => {
            server.off("error", reject);
            // Stops listening; the phone remote's next check (phone.ts) notices and starts again.
            server.on("error", () => server.close());
            resolve(server);
        });
    });

/** Closes the server and every connection to it, phones' streams included. */
export const closeServer = (server: http.Server): Promise<void> =>
    new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
    });
