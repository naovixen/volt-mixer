import type { Intent, IntentResult } from "../intents.ts";
import { analogIds, channelById, phantomMask, type ChannelId } from "../mixer.ts";
import type { ICore } from "./core.ts";

/*
 * A Volt that has been off the bus (its computer shut down, a KVM switch, a USB dropout) can come
 * back with 48V off, and a condenser mic is then silent until someone notices. UAD Console puts
 * 48V back from its session when it starts; the engine does the same from what this computer last
 * saw on that Volt (in the store). Only on connecting, and only ever on: 48V that goes off while
 * the Volt is connected was turned off by someone, and that is remembered too.
 */

export interface IPhantomKeeper {
    /** Keeps the Volt's 48V as it is now, while this engine drives the Volt. */
    remember: () => void;
    /** Once the Volt's state is known: 48V back on where it was on when the Volt was last here. */
    restore: () => void;
}

/** The inputs whose preamp is in `mask` (bit 0 = Input 1). */
const inputsIn = (mask: number): ChannelId[] =>
    analogIds.filter((id) => {
        const preamp = channelById[id].preampIndex;
        return preamp !== undefined && (mask & (1 << preamp)) !== 0;
    });

export const createPhantomKeeper = (core: ICore, runIntent: (intent: Intent) => IntentResult): IPhantomKeeper => {
    let keptSerial = "";
    let keptMask = -1;

    const remember = (): void => {
        const { serial } = core.flags;
        const mask = phantomMask(core.state);
        if (!core.isLive() || !serial || (serial === keptSerial && mask === keptMask)) return;
        keptSerial = serial;
        keptMask = mask;
        core.store.savePhantom(serial, mask);
    };

    return {
        remember,
        restore: () => {
            if (!core.isLive() || !core.flags.serial) return;
            const lost = (core.store.loadPhantom(core.flags.serial) ?? 0) & ~phantomMask(core.state);
            const ids = inputsIn(lost);
            if (ids.length === 0) return;
            // As an edit of the user's own: a reading taken before the Volt has it on again is ignored.
            runIntent({ type: "phantom", ids, to: true });
            const names = ids.map((id) => core.state.names[id] ?? channelById[id].name).join(" and ");
            core.message(`The Volt came back with 48V off, so it's on again for ${names}, as you left it.`, "info");
        },
    };
};
