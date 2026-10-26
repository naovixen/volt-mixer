import type { ConditionCommand, ICondition } from "../lib/engine/core.ts";
import { fillMessage, type MessageKind } from "./messages.ts";

/*
 * The notice bar at the top of the page (Notice.astro). It holds the engine's lasting conditions
 * (an unchecked firmware, another tab in use, another Volt Mixer with the mix), each until it no
 * longer holds, and below them the latest passing message. A passing message never replaces a
 * condition, so a condition's button (Use anyway) can't be lost. Each row can be dismissed; a
 * dismissed condition comes back only when it changes.
 */

export interface INoticeOptions {
    /** What sort of message it is; a warning unless said otherwise. */
    kind?: MessageKind;
    /** A button that does something about it. */
    action?: { label: string; run: () => void };
}

interface INotice extends INoticeOptions {
    text: string;
}

const passingKey = "passing";
const shown = new Map<string, INotice>();
/** Conditions dismissed, with what they said then. */
const dismissed = new Map<string, string>();

const region = (): HTMLElement | null => document.querySelector<HTMLElement>("[data-notice]");
const signature = ({ text, kind = "warning" }: INotice): string => `${kind}:${text}`;

const dismissButton = (key: string): HTMLButtonElement => {
    const template = document.querySelector<HTMLTemplateElement>("#notice-dismiss")!;
    const button = template.content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
    button.addEventListener("click", () => {
        const item = shown.get(key);
        if (item && key !== passingKey) dismissed.set(key, signature(item));
        shown.delete(key);
        render();
        document.querySelector<HTMLElement>("#main")?.focus();
    });
    return button;
};

const actionButton = ({ label, run }: NonNullable<INoticeOptions["action"]>): HTMLButtonElement => {
    const button = Object.assign(document.createElement("button"), { type: "button", className: "button" });
    button.textContent = label;
    button.addEventListener("click", run);
    return button;
};

const buildRow = (key: string, item: INotice): HTMLElement => {
    const { text, kind = "warning", action } = item;
    const row = Object.assign(document.createElement("div"), { className: "message-box notice-item" });
    Object.assign(row.dataset, { noticeItem: key, kind, signature: signature(item) });
    // Warnings and errors interrupt; news and confirmations wait their turn (the region is polite).
    if (kind === "warning" || kind === "error") row.setAttribute("role", "alert");
    const message = Object.assign(document.createElement("p"), { className: "message notice-text" });
    fillMessage(message, kind, text);
    row.append(message, ...(action ? [actionButton(action)] : []), dismissButton(key));
    return row;
};

/** Rows that haven't changed stay as they are, so focus on one of their buttons isn't lost. */
const render = (): void => {
    const container = region();
    if (!container) return;
    const existing = new Map([...container.children].map((row) => [(row as HTMLElement).dataset["noticeItem"], row]));
    // Conditions first, the passing message last.
    const items = [...shown].sort(([a], [b]) => Number(a === passingKey) - Number(b === passingKey));
    const rows = items.map(([key, item]) => {
        const row = existing.get(key) as HTMLElement | undefined;
        return row?.dataset["signature"] === signature(item) ? row : buildRow(key, item);
    });
    const isSame = rows.length === container.children.length && rows.every((row, i) => container.children[i] === row);
    if (!isSame) container.replaceChildren(...rows);
};

/** Shows a passing message about the whole page, replacing the last one; "" clears it. */
export const notice = (text: string, options: INoticeOptions = {}): void => {
    shown.delete(passingKey);
    if (text) shown.set(passingKey, { text, ...options });
    render();
};

/**
 * Shows a lasting condition under `key` until it's set to null. Setting it again with the same
 * words leaves it as it is, and dismissed if it was.
 */
const setCondition = (key: string, text: string | null, options: INoticeOptions = {}): void => {
    const next = text ? { text, ...options } : null;
    if (!next) dismissed.delete(key);
    if (next && dismissed.get(key) === signature(next)) return;
    dismissed.delete(key);
    const current = shown.get(key);
    if (next && current && signature(current) === signature(next)) return;
    if (next) shown.set(key, next);
    else shown.delete(key);
    render();
};

/** The engine's conditions, as they are now; `run` does what a condition's button asks. */
export const showConditions = (conditions: ICondition[], run: (command: ConditionCommand) => void): void => {
    const keys = new Set(conditions.map(({ key }) => key));
    for (const key of [...shown.keys()]) if (key !== passingKey && !keys.has(key)) setCondition(key, null);
    for (const { key, text, kind, action } of conditions) {
        const button = action && { label: action.label, run: () => run(action.command) };
        setCondition(key, text, { kind, ...(button ? { action: button } : {}) });
    }
};
