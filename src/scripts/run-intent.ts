import type { Intent } from "../lib/intents.ts";
import { getEngine } from "./engine-client.ts";
import { notice } from "./notices.ts";

/* This page's own controls change things through the engine, as the tray window and phones do. */

/** Called when a change was refused, so the control that asked shows the state again. */
let onRefused = (): void => {};

export const whenRefused = (listen: () => void): void => {
    onRefused = listen;
};

/** Mix changes need this computer to own the mix. */
const explainNeedsMix = (): void => {
    const held = getEngine().snapshot().heldText;
    if (held) return notice(held, { kind: "info" });
    notice("That works once this computer has your mix: set one up below, or open a mix link.");
};

/**
 * For this page's own controls: runs the intent, and says why if it has to wait for the mix. The
 * views then show the state again, so a slider that was moved goes back.
 */
export const runPageIntent = (intent: Intent): void => {
    const result = getEngine().runIntent(intent);
    if (result === "ok") return;
    if (result === "needsMix") explainNeedsMix();
    onRefused();
};
