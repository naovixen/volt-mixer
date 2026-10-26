import { describe, expect, test } from "vitest";
import { toHex } from "../commands.ts";
import { intentChanges } from "./changes.ts";
import { applyIntent, type Intent } from "../intents.ts";
import { defaultState, setLinked, type IMixerState } from "../mixer.ts";
import { specFor } from "../spec.ts";
import { createMixerSync } from "./sync.ts";

const spec = specFor("1.0.3").spec;

const ownedState = (): IMixerState => {
    const state = defaultState();
    state.isMixOwned = true;
    setLinked(state, ["in3", "in4"], true);
    return state;
};

/** The reports for `intent`: comparing only the channels it touched, and comparing every channel. */
const bothWays = (intent: Intent): [string[], string[]] => {
    const state = ownedState();
    const [some, all] = [createMixerSync(), createMixerSync()];
    some.prime(state, spec);
    all.prime(state, spec);
    applyIntent(state, intent, spec);
    const { channels } = intentChanges(intent, state);
    return [some.diff(state, spec, { channels }).map(toHex), all.diff(state, spec).map(toHex)];
};

const intents: [string, Intent][] = [
    ["a fader", { type: "fader", ids: ["in1"], db: -7 }],
    ["a linked pair's fader", { type: "fader", ids: ["in3"], db: -12 }],
    ["a solo", { type: "solo", ids: ["in2"] }],
    ["a cue send", { type: "cueSend", ids: ["loopbackL"], cue: "cue1", db: -4 }],
    ["a pan", { type: "pan", id: "in2", pan: 0.5 }],
    ["a link", { type: "link", id: "in1" }],
    ["a digital mute", { type: "mute", ids: ["loopbackR"] }],
];

for (const [name, intent] of intents) {
    describe(`Using the sync with only the touched channels, when ${name} changes`, () => {
        test("then it should send what comparing every channel would", () => {
            const [some, all] = bothWays(intent);
            expect(some).toEqual(all);
        });
    });
}
