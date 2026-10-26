// What the bench's fake Volt (fake-volt.js) answers with, built from src/data so it matches the
// protocol the page expects: identify reply, a state dump, meter offsets, and a saved mix to seed.
import { defaultState } from "../../src/lib/mixer.ts";
import { toSavedMix } from "../../src/lib/saved-mix.ts";
import { protocol, specFor } from "../../src/lib/spec.ts";

export const benchSerial = "BENCH0001";
const benchVersion = "1.0.5";
/* The Volt's input reports are 74 bytes with the report ID; the page sees the 73 after it. */
const inputBytes = 73;

const spec = specFor(benchVersion).spec;

/** VID, PID (LE), bcdDevice (minor/patch nibbles, then BCD major), then the serial in ASCII. */
const identifyReply = () => {
    const [major, minor, patch] = benchVersion.split(".").map(Number);
    const serial = [...benchSerial].map((character) => character.charCodeAt(0));
    const { vendorId, productId } = protocol;
    return [vendorId & 0xff, vendorId >> 8, productId & 0xff, productId >> 8, (minor << 4) | patch, major, ...serial];
};

/** A state dump: everything on Direct, levels about half way, display lit, as a Volt in use. */
const stateDump = () => {
    const layout = spec.stateLayout;
    const bytes = new Array(inputBytes).fill(0);
    const at = (offset, value) => (bytes[1 + offset] = value);
    const word = (offset, value) => (at(offset, value & 0xff), at(offset + 1, value >> 8));
    bytes[0] = spec.commands.stateRequest;
    at(layout.directMask, 0x0f);
    word(layout.monitorLevel, 40 * spec.monitorLevelPerUnit);
    word(layout.headphoneLevelU16, 45 * spec.headphoneLevelScale);
    layout.preampGainU16.forEach((offset) => word(offset, 20 * spec.preampGainStepsPerDb));
    at(layout.clipProtection, 1);
    at(layout.brightness, 180);
    return bytes;
};

/** Raw meter peaks per meter (full scale 32767): a voice, a quieter source, two quiet lines, music. */
const meterLevels = { in1: 9000, in2: 3000, in3: 400, in4: 400, monitorL: 12000, monitorR: 11000 };

export const fakeVoltConfig = () => ({
    vendorId: protocol.vendorId,
    productId: protocol.productId,
    controlUsagePage: protocol.controlUsagePage,
    commandId: spec.reports.command.id,
    identifyId: spec.reports.identify.id,
    identifyReplyId: spec.reports.identifyReply.id,
    metersId: spec.reports.meters.id,
    stateRequestCmd: spec.commands.stateRequest,
    inputBytes,
    identifyReply: identifyReply(),
    stateDump: stateDump(),
    meterOffsets: spec.reports.meters.offsets,
    meterLevels,
});

/** This computer's mix, as the page saves it: Inputs 1–4 on, so a drag sends their crosspoints. */
export const seededMix = () => {
    const state = defaultState();
    for (const id of ["in1", "in2", "in3", "in4"]) state.channels[id].isMuted = false;
    state.isMixOwned = true;
    return toSavedMix(state);
};
