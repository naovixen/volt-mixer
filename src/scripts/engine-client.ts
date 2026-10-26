import type { IEngineSnapshot, IVoltEngine } from "../lib/engine/engine.ts";
import { specFor, newestSpec, type ISpec } from "../lib/spec.ts";

/*
 * The engine the views talk to. On the website it runs in this page (host-web.ts); the views
 * only ever read its snapshot and send it intents, so where it runs is the host's business.
 */

let engine: IVoltEngine | null = null;

export const useEngine = (next: IVoltEngine): void => {
    engine = next;
};

export const getEngine = (): IVoltEngine => {
    if (!engine) throw new Error("The engine isn't running yet.");
    return engine;
};

/** What the views show now. */
export const snap = (): IEngineSnapshot => getEngine().snapshot();

/** The connected Volt's protocol data, or the newest recorded one while none is. */
export const viewSpec = (snapshot: IEngineSnapshot = snap()): ISpec =>
    snapshot.connection ? specFor(snapshot.connection.specVersion).spec : newestSpec();
