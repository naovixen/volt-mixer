import protocolData from "../data/volt4-gen2.json" with { type: "json" };

/** Every command the page sends. A firmware's spec must name them all before anything is sent. */
export const commandNames = [
    "crosspoint",
    "route",
    "phantomMask",
    "digitalFormat",
    "stateRequest",
    "muteWord",
    "preampGain",
    "monitorMono",
    "headphone",
    "clipProtection",
    "brightness",
    "tone",
    "identifyLights",
    "panelState",
    "autoGain",
] as const;
export type CommandName = (typeof commandNames)[number];

/** The fields of the mute word (command `muteWord`) the page reads and writes. */
export const muteFields = ["direct", "monitorMute", "monitorLevel"] as const;
export type MuteField = (typeof muteFields)[number];

/** The Volt's digital input formats, as spec.digitalFormat names them. */
export const digitalFormats = ["adat", "spdif"] as const;
export type DigitalFormat = (typeof digitalFormats)[number];

/** Console's scale for the monitor and headphone levels: 0 to this. The spec maps it to raw values. */
export const outputLevelMax = 100;

/** The stereo buses each channel feeds. */
export const busNames = ["monitor", "cue1", "cue2"] as const;
export type BusName = (typeof busNames)[number];

export interface IReportIds {
    command: { id: number; bytes: number };
    identify: { id: number; bytes: number; payload: number[] };
    identifyReply: { id: number };
    stateReply: { id: number; cmd: number };
    meters: { id: number; fullScale: number; offsets: Record<string, number> };
}

export interface IStateLayout {
    phantomMask: number;
    digitalFormat: number;
    linkMask: number;
    directMask: number;
    monitorMute: number;
    monitorLevel: number;
    preampGainU16: number[];
    monitorMono: number;
    headphoneLevelU16: number;
    clipProtection: number;
    brightness: number;
    toneNibbles: number[];
    headphoneMute: number;
}

/** One firmware's protocol, as recorded in src/data/volt4-gen2.json. */
export interface ISpec {
    reports: IReportIds;
    end: number;
    commands: Record<CommandName, number>;
    gainUnity: number;
    faderMaxDb: number;
    preampGainStepsPerDb: number;
    preampGainMaxDb: number;
    headphoneLevelScale: number;
    headphoneLevelMax: number;
    monitorLevelMax: number;
    monitorLevelPerUnit: number;
    autoGainSeconds: { min: number; max: number; default: number };
    /** Mixer source per channel (src/lib/mixer.ts channel IDs). */
    sources: Partial<Record<string, number>>;
    mixBuses: Record<BusName, [number, number]>;
    routeDestinations: Record<string, [number, number]>;
    routeSources: Record<string, [number, number]>;
    muteWordFields: Record<MuteField, number>;
    muteWordOffsets: Record<MuteField, number>;
    linkState: { field: number; hostFlag: number };
    stateLayout: IStateLayout;
    tone: string[];
    digitalFormat: string[];
}

/** A firmware that shares another's spec, verified byte-identical (see docs/maintaining.md). */
export interface IFirmwareAlias {
    sameAs: string;
}

export interface IProtocol {
    device: string;
    vendorId: number;
    productId: number;
    /** The vendor usage page of the HID interface that takes commands. */
    controlUsagePage: number;
    /** Every Volt's name by decimal USB product ID, so an unsupported one can be named. */
    models: Record<string, string>;
    /** A firmware is its own spec, or an alias to the version it was verified identical to. */
    firmware: Record<string, ISpec | IFirmwareAlias>;
}

/** The model name for a UA USB product ID ("Volt 2 Max"), or a generic name. */
export const modelName = (productId: number, source: IProtocol = protocol): string =>
    source.models[String(productId)] ?? "This Volt";

export interface ISpecChoice {
    version: string;
    isExact: boolean;
    spec: ISpec;
}

export const protocol = protocolData as unknown as IProtocol;

export const compareVersions = (a: string, b: string): number => {
    const left = a.split(".").map(Number);
    const right = b.split(".").map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const difference = (left[i] ?? 0) - (right[i] ?? 0);
        if (difference) return difference;
    }
    return 0;
};

type Check = (value: unknown) => boolean;
/** A check for each field of `T`: the compiler insists on one per field, so none is left unchecked. */
type Shape<T> = { [K in keyof T]-?: Check | Shape<T[K]> };

const isNumber: Check = (value) => typeof value === "number" && Number.isFinite(value);
const isInteger: Check = (value) => Number.isInteger(value);
const listOf =
    (check: Check, length?: number): Check =>
    (value) =>
        Array.isArray(value) && (length === undefined || value.length === length) && value.every(check);
const isPair = listOf(isInteger, 2);
const recordOf =
    (check: Check): Check =>
    (value) =>
        typeof value === "object" && value !== null && Object.values(value).every(check);
const isString: Check = (value) => typeof value === "string";
const including =
    (...names: string[]): Check =>
    (value) =>
        listOf(isString)(value) && names.every((name) => (value as string[]).includes(name));
const fields = <T extends string>(names: readonly T[], check: Check): Record<T, Check> =>
    Object.fromEntries(names.map((name) => [name, check])) as Record<T, Check>;

const specShape: Shape<ISpec> = {
    reports: {
        command: { id: isInteger, bytes: isInteger },
        identify: { id: isInteger, bytes: isInteger, payload: listOf(isInteger) },
        identifyReply: { id: isInteger },
        stateReply: { id: isInteger, cmd: isInteger },
        meters: { id: isInteger, fullScale: isInteger, offsets: recordOf(isInteger) },
    },
    end: isInteger,
    commands: fields(commandNames, isInteger),
    gainUnity: isInteger,
    faderMaxDb: isNumber,
    preampGainStepsPerDb: isNumber,
    preampGainMaxDb: isNumber,
    headphoneLevelScale: isNumber,
    headphoneLevelMax: isInteger,
    monitorLevelMax: isInteger,
    monitorLevelPerUnit: isNumber,
    autoGainSeconds: { min: isInteger, max: isInteger, default: isInteger },
    sources: recordOf(isInteger),
    mixBuses: fields(busNames, isPair),
    routeDestinations: recordOf(isPair),
    routeSources: recordOf(isPair),
    muteWordFields: fields(muteFields, isInteger),
    muteWordOffsets: fields(muteFields, isInteger),
    linkState: { field: isInteger, hostFlag: isInteger },
    stateLayout: {
        phantomMask: isInteger,
        digitalFormat: isInteger,
        linkMask: isInteger,
        directMask: isInteger,
        monitorMute: isInteger,
        monitorLevel: isInteger,
        preampGainU16: listOf(isInteger, 2),
        monitorMono: isInteger,
        headphoneLevelU16: isInteger,
        clipProtection: isInteger,
        brightness: isInteger,
        toneNibbles: listOf(isInteger, 2),
        headphoneMute: isInteger,
    },
    tone: listOf(isString),
    digitalFormat: including(...digitalFormats),
};

/** The paths in `value` that `shape` finds missing or malformed ("commands.tone", …). */
const missingFrom = (shape: Shape<unknown> | Check, value: unknown, path: string): string[] => {
    if (typeof shape === "function") return shape(value) ? [] : [path];
    const record = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
    return Object.entries(shape).flatMap(([key, inner]) =>
        missingFrom(inner as Shape<unknown> | Check, record[key], path ? `${path}.${key}` : key),
    );
};

/** What a firmware's spec lacks of what the page needs ("commands.tone", …); empty when it's complete. */
export const missingFromSpec = (spec: ISpec): string[] => missingFrom(specShape as Shape<unknown>, spec, "");

/** The spec a firmware entry resolves to, following a `sameAs` alias; undefined if it dead-ends. */
const resolveSpec = (source: IProtocol, version: string, seen: Set<string> = new Set()): ISpec | undefined => {
    const entry = source.firmware[version];
    if (entry === undefined || seen.has(version)) return undefined;
    if ("sameAs" in entry) return resolveSpec(source, entry.sameAs, seen.add(version));
    return entry;
};

/**
 * The spec for a firmware version, or the newest known one when the version isn't recorded. A
 * spec missing anything the page sends is never chosen, so no command goes out with a guessed byte.
 * An alias (`sameAs`) resolves to the spec it was verified identical to and counts as an exact match.
 */
export const specFor = (version: string, source: IProtocol = protocol): ISpecChoice => {
    const isComplete = (known: string): boolean => {
        const spec = resolveSpec(source, known);
        return spec !== undefined && missingFromSpec(spec).length === 0;
    };
    const complete = Object.keys(source.firmware).filter(isComplete).sort(compareVersions);
    const isExact = complete.includes(version);
    const chosen = isExact ? version : complete.at(-1);
    if (chosen === undefined) throw new Error("No firmware in the protocol data is complete (see missingFromSpec).");
    return { version: chosen, isExact, spec: resolveSpec(source, chosen)! };
};

export const newestSpec = (): ISpec => specFor("").spec;
