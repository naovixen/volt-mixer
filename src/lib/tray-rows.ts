import { iconOf } from "./channel-icons.ts";
import type { ChannelId, IMixerState } from "./mixer.ts";
import { stripGroups, toneOf, type IStripView, type ToneName } from "./strip-groups.ts";

/*
 * The tray mixer's rows, built by the main window and drawn by the tray window. The tray only
 * draws; everything it shows comes from here, and everything it changes goes back as an intent.
 */

export interface ITrayRow {
    /** Stable while the row's channels stay the same. */
    key: string;
    kind: "channel" | "monitor" | "headphone";
    name: string;
    /** A name from src/lib/channel-icons.ts, or "speaker" for the Monitor output. */
    icon: string;
    /** The channels a channel row moves together (one, or a linked pair); none for an output. */
    ids: ChannelId[];
    /** Fader dB for a channel, 0–100 for an output. */
    level: number;
    isMuted: boolean;
    tone: ToneName;
}

/* The outputs are always in the tray; only channels can be left out. Monitor above Headphones, as on the page. */
const outputRows = (state: IMixerState): ITrayRow[] => [
    {
        key: "monitor",
        kind: "monitor",
        name: "Monitor",
        icon: "speaker",
        ids: [],
        level: state.monitor.level,
        isMuted: state.monitor.isMuted,
        tone: "off",
    },
    {
        key: "headphone",
        kind: "headphone",
        name: "Headphones",
        icon: "headphones",
        ids: [],
        level: state.headphone.level,
        isMuted: state.headphone.isMuted,
        tone: "off",
    },
];

/** A linked pair shows while either side is wanted, so linking never hides a channel. */
export const isShownInTray = (ids: readonly ChannelId[], hidden: string[]): boolean =>
    ids.some((id) => !hidden.includes(id));

/** Monitor, Headphones, then the strips shown on the page that the viewer hasn't left out. */
export const trayRows = (state: IMixerState, view: IStripView, hidden: string[]): ITrayRow[] => [
    ...outputRows(state),
    ...stripGroups(state, view)
        .filter((group) => isShownInTray(group.ids, hidden))
        .map((group): ITrayRow => {
            const first = state.channels[group.ids[0]];
            return {
                key: group.ids.join(","),
                kind: "channel",
                name: group.name,
                icon: iconOf(state.icons, group.ids[0]),
                ids: [...group.ids],
                level: first.fader,
                isMuted: first.isMuted,
                tone: toneOf(state, group.ids),
            };
        }),
];
