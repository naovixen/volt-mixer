import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { IReport } from "../commands.ts";
import { createSendPump } from "./send-pump.ts";

const report: IReport = { reportId: 240, data: new Uint8Array([1]) };

beforeEach(() => void vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
afterEach(() => void vi.useRealTimers());

/** A pump whose batches are counted, each taking `writeMs` to write. */
const countingPump = (writeMs = 0) => {
    const writes: number[] = [];
    let collected = 0;
    const pump = createSendPump({
        intervalMs: 20,
        collect: () => (collected++, [report]),
        write: () => {
            writes.push(performance.now());
            return new Promise((resolve) => setTimeout(resolve, writeMs));
        },
    });
    return { pump, writes, collected: () => collected };
};

describe("Using the send pump, when a control changes a hundred times in one interval", () => {
    test("then it should send one batch", async () => {
        const { pump, writes } = countingPump();
        for (let i = 0; i < 100; i++) pump.schedule();
        await vi.advanceTimersByTimeAsync(19);
        expect(writes.length).toBe(1);
    });
});

describe("Using the send pump, when changes keep coming for a second", () => {
    test("then it should send at most one batch every 20 ms", async () => {
        const { pump, writes } = countingPump();
        for (let ms = 0; ms < 1000; ms += 4) {
            pump.schedule();
            await vi.advanceTimersByTimeAsync(4);
        }
        expect(writes.length).toBeLessThanOrEqual(51);
    });
});

describe("Using the send pump, when the first change comes after a quiet spell", () => {
    test("then it should send it without waiting", async () => {
        const { pump, writes } = countingPump();
        await vi.advanceTimersByTimeAsync(500);
        pump.schedule();
        await vi.advanceTimersByTimeAsync(0);
        expect(writes).toEqual([500]);
    });
});

describe("Using the send pump, when a batch takes longer to write than the interval", () => {
    test("then it should wait for it before sending the next", async () => {
        const { pump, writes } = countingPump(100);
        pump.schedule();
        await vi.advanceTimersByTimeAsync(1);
        pump.schedule();
        await vi.advanceTimersByTimeAsync(60);
        expect(writes.length).toBe(1);
    });
});

describe("Using the send pump, when a slow batch finishes with a change waiting", () => {
    test("then it should send the change straight after", async () => {
        const { pump, writes } = countingPump(100);
        pump.schedule();
        await vi.advanceTimersByTimeAsync(1);
        pump.schedule();
        // A timer of 0 ms takes 1 ms.
        await vi.advanceTimersByTimeAsync(101);
        expect(writes).toEqual([0, 101]);
    });
});

describe("Using the send pump, when it's flushed with a change waiting", () => {
    test("then it should send at once", async () => {
        const { pump, writes } = countingPump();
        pump.schedule();
        await vi.advanceTimersByTimeAsync(0);
        pump.schedule();
        pump.flush();
        expect(writes.length).toBe(2);
    });
});

describe("Using the send pump, when it's stopped with a change waiting", () => {
    test("then it should send nothing more", async () => {
        const { pump, collected } = countingPump();
        pump.schedule();
        pump.stop();
        await vi.advanceTimersByTimeAsync(100);
        expect(collected()).toBe(0);
    });
});
