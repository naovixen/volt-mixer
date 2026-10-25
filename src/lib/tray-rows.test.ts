import { describe, expect, test } from "vitest";
import { defaultState, setLinked } from "./mixer.ts";
import { isShownInTray, trayRows } from "./tray-rows.ts";

const view = { isDigitalShown: false, isLoopbackShown: true };

const linkedState = () => {
    const state = defaultState();
    setLinked(state, ["in3", "in4"], true);
    return state;
};

describe("Using trayRows, when no channel has been left out", () => {
    test("then it should list the outputs first, then every strip on the page", () => {
        expect(trayRows(linkedState(), view, []).map((row) => row.name)).toEqual([
            "Monitor",
            "Headphones",
            "Input 1",
            "Input 2",
            "Line 3/4",
            "Loopback",
        ]);
    });
});

describe("Using trayRows, when every channel has been left out", () => {
    test("then it should still show the outputs", () => {
        const hidden = ["in1", "in2", "in3", "in4", "loopbackL", "loopbackR"];
        expect(trayRows(linkedState(), view, hidden).map((row) => row.kind)).toEqual(["monitor", "headphone"]);
    });
});

describe("Using trayRows, when one unlinked channel is left out", () => {
    test("then it should keep its neighbour", () => {
        expect(trayRows(defaultState(), view, ["in4"]).map((row) => row.name)).toContain("Line 3");
    });
});

describe("Using isShownInTray, when only one side of a linked pair was left out", () => {
    test("then it should still show the pair", () => {
        expect(isShownInTray(["in3", "in4"], ["in4"])).toBe(true);
    });
});

describe("Using trayRows, when a channel has a mic preamp", () => {
    test("then it should give its row the mic icon", () => {
        expect(trayRows(defaultState(), view, []).find((row) => row.key === "in1")?.icon).toBe("mic");
    });
});

describe("Using trayRows, when a channel is the computer's loopback", () => {
    test("then it should give its row the laptop icon", () => {
        expect(trayRows(defaultState(), view, []).find((row) => row.name === "Loopback")?.icon).toBe("laptop");
    });
});

describe("Using trayRows, when Input 1 has the Warmth tone", () => {
    test("then it should carry the tone in its row, for the fader colour", () => {
        const state = defaultState();
        state.tone[0] = 1;
        expect(trayRows(state, view, []).find((row) => row.key === "in1")?.tone).toBe("warmth");
    });
});

describe("Using trayRows, when a channel has a chosen icon", () => {
    test("then it should use it in its row", () => {
        const state = defaultState();
        state.icons["in3"] = "gamepad-2";
        expect(trayRows(state, view, []).find((row) => row.key === "in3")?.icon).toBe("gamepad-2");
    });
});
