import type { IEngineSnapshot } from "../lib/engine/engine.ts";
import type { IConnectionInfo } from "../lib/engine/ports.ts";
import { setText } from "./dom.ts";
import { viewSpec } from "./engine-client.ts";
import { resetMeters } from "./meters-view.ts";
import { notice } from "./notices.ts";
import { useSliderSpec } from "./slider.ts";
import * as volt from "./transport-webhid.ts";

/* What the page shows about the connection: the status, the Connect buttons, and the Volt's details. */

const element = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;

const deviceText = (info: IConnectionInfo | null): string => {
    if (!info) return "Not connected.";
    if (!info.isIdentified) return "The Volt didn't identify itself.";
    const match = info.isExact ? "" : " (closest match)";
    return `Firmware ${info.version}, serial ${info.serial}. Checked against firmware ${info.specVersion}${match}.`;
};

/** The connection the page last showed, so a new one resets the sliders' ranges and the meters. */
let shownSerial: string | null = null;

export const renderConnection = (snapshot: IEngineSnapshot): void => {
    const { connection, status } = snapshot;
    const isConnected = connection !== null;
    const statusElement = element("[data-status]");
    setText(statusElement, status.text);
    statusElement.dataset["status"] = status.kind;
    element("[data-action='connect']").hidden = isConnected;
    element("[data-action='disconnect']").hidden = !isConnected;
    setText(element("#about-volt-description"), deviceText(connection));
    const serial = connection ? `${connection.serial}:${connection.specVersion}` : null;
    if (serial === shownSerial) return;
    shownSerial = serial;
    useSliderSpec(viewSpec(snapshot));
    resetMeters();
};

export const connectionActions: Record<string, () => void> = {
    connect: () =>
        void volt
            .pair()
            .then(
                (result) =>
                    result === "cancelled" &&
                    notice('No Volt was chosen. Click Connect Volt and pick "Volt 4 Gen 2".', { kind: "info" }),
            ),
    disconnect: () => void volt.disconnect(),
};
