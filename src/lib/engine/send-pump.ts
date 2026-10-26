import type { IReport } from "../commands.ts";

/*
 * Sends what changed at a fixed pace, not once per screen frame: a 240 Hz screen would otherwise
 * send a fader's crosspoints 240 times a second, more than a full-speed USB link takes in, so the
 * writes would queue up behind the hand. Every change in between is merged (the latest value of
 * each control wins, because `collect` diffs the state against what was last sent), and while a
 * batch is still being written the next one waits for it.
 */

export interface ISendPump {
    /** Something changed: it goes out at the next tick, or after `waitMs` if that's later. */
    schedule: (waitMs?: number) => void;
    /** Sends what's waiting now, behind anything already on its way. */
    flush: () => void;
    /** Whether a change is waiting to go. */
    isPending: () => boolean;
    stop: () => void;
}

interface IPumpOptions {
    /** The shortest time between two batches. */
    intervalMs: number;
    /** The reports for everything that changed since the last batch; may be none. */
    collect: () => IReport[];
    /** Writes a batch; resolves once it's written (or dropped with the link). */
    write: (reports: IReport[]) => Promise<void>;
}

export const createSendPump = ({ intervalMs, collect, write }: IPumpOptions): ISendPump => {
    let isPending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timerAt = Infinity;
    let sentAt = -Infinity;
    let writing: Promise<void> | null = null;

    const send = (): void => {
        isPending = false;
        sentAt = performance.now();
        const reports = collect();
        if (reports.length === 0) return;
        const batch = write(reports).finally(() => {
            if (writing !== batch) return;
            writing = null;
            if (isPending) schedule();
        });
        writing = batch;
    };

    const tick = (): void => {
        timer = undefined;
        timerAt = Infinity;
        // Still writing: the change waits, and goes as soon as that batch is out.
        if (writing || !isPending) return;
        send();
    };

    const schedule = (waitMs = 0): void => {
        isPending = true;
        const at = Math.max(sentAt + intervalMs, performance.now() + waitMs);
        if (timer !== undefined && timerAt <= at) return;
        clearTimeout(timer);
        timerAt = at;
        timer = setTimeout(tick, Math.max(0, at - performance.now()));
    };

    return {
        schedule,
        flush: () => {
            clearTimeout(timer);
            timer = undefined;
            timerAt = Infinity;
            send();
        },
        isPending: () => isPending,
        stop: () => {
            clearTimeout(timer);
            timer = undefined;
            timerAt = Infinity;
            isPending = false;
        },
    };
};
