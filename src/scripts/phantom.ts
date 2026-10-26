import { channelById, type ChannelId } from "../lib/mixer.ts";
import { snap } from "./engine-client.ts";
import { runPageIntent } from "./run-intent.ts";

/**
 * 48V for the preamps among `ids` (the strip's tag and the channel dialog's button). Turning it
 * on asks first, like Console's warning; turning it off doesn't.
 */
export const togglePhantom = (ids: readonly ChannelId[]): void => {
    const indexes = ids
        .map((id) => channelById[id].preampIndex)
        .filter((index): index is number => index !== undefined);
    if (indexes.length === 0) return;
    const isOn = indexes.every((index) => snap().state.preamp.phantom[index]);
    const question = "Turn on 48V phantom power? Only for condenser mics; it can damage ribbon mics.";
    if (!isOn && !window.confirm(question)) return;
    runPageIntent({ type: "phantom", ids: [...ids], to: !isOn });
};
