import { describe, expect, test } from "vitest";
import { defaultState, type IMixerState } from "../mixer.ts";
import type { IEngineSnapshot } from "./engine.ts";
import { createMirror, type IPatch } from "./mirror.ts";

const snapshotWith = (change: (state: IMixerState) => void = () => {}): IEngineSnapshot => {
    const state = defaultState();
    state.isMixOwned = true;
    change(state);
    return {
        state,
        view: { isDigitalShown: false, isLoopbackShown: true, trayHidden: [] },
        connection: null,
        status: { text: "Not connected", kind: "off" },
        isLive: false,
        isHardwareKnown: false,
        isSendAllowed: false,
        hasControl: true,
        mixHold: null,
        heldText: null,
        conditions: [],
    };
};

const patch = (seq: number, snapshot: IEngineSnapshot, topics: string[] = [], channels: string[] = []): IPatch => ({
    seq,
    snapshot,
    changes: { topics, channels },
});

describe("Using the mirror, when the page moves a fader", () => {
    test("then it should show the new level at once", () => {
        const mirror = createMirror();
        mirror.applyPatch(patch(0, snapshotWith()));
        mirror.runIntent({ type: "fader", ids: ["in1"], db: -10 });
        expect(mirror.snapshot()?.state.channels.in1.fader).toBe(-10);
    });
});

describe("Using the mirror, when a patch from before the page's change arrives", () => {
    test("then it should keep the page's level", () => {
        const mirror = createMirror();
        mirror.applyPatch(patch(0, snapshotWith()));
        mirror.runIntent({ type: "fader", ids: ["in1"], db: -10 });
        mirror.applyPatch(patch(0, snapshotWith(), ["outputs"]));
        expect(mirror.snapshot()?.state.channels.in1.fader).toBe(-10);
    });
});

describe("Using the mirror, when a patch from before the page's change says the status changed", () => {
    test("then it should take the new status", () => {
        const mirror = createMirror();
        mirror.applyPatch(patch(0, snapshotWith()));
        mirror.runIntent({ type: "fader", ids: ["in1"], db: -10 });
        const connected = { ...snapshotWith(), status: { text: "Connected", kind: "on" as const } };
        mirror.applyPatch(patch(0, connected, ["status"]));
        expect(mirror.snapshot()?.status.text).toBe("Connected");
    });
});

describe("Using the mirror, when main refused the page's change", () => {
    test("then the patch that answers it should put the level back", () => {
        const mirror = createMirror();
        mirror.applyPatch(patch(0, snapshotWith()));
        const { seq } = mirror.runIntent({ type: "fader", ids: ["in1"], db: -10 });
        mirror.applyPatch(patch(seq, snapshotWith()));
        expect(mirror.snapshot()?.state.channels.in1.fader).toBe(0);
    });
});

describe("Using the mirror, when main answers the page's change with nothing new", () => {
    test("then it should still redraw the channel the page changed", () => {
        const mirror = createMirror();
        mirror.applyPatch(patch(0, snapshotWith()));
        const { seq } = mirror.runIntent({ type: "fader", ids: ["in2"], db: -10 });
        expect([...mirror.applyPatch(patch(seq, snapshotWith())).channels]).toContain("in2");
    });
});

describe("Using the mirror, when a stale patch said a channel changed", () => {
    test("then the patch that catches up should redraw it", () => {
        const mirror = createMirror();
        mirror.applyPatch(patch(0, snapshotWith()));
        const { seq } = mirror.runIntent({ type: "fader", ids: ["in1"], db: -10 });
        mirror.applyPatch(patch(0, snapshotWith(), ["channels"], ["in3"]));
        expect([...mirror.applyPatch(patch(seq, snapshotWith())).channels]).toContain("in3");
    });
});
