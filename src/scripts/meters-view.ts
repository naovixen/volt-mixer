import type { IMeterFrame } from "../lib/engine/meters.ts";
import { clipDb, meterFill, peakFallDbPerSecond } from "../lib/meters.ts";

/*
 * Draws the meters from the engine's meter frames (at most 30 a second, each the highest peak
 * since the last), with a falling peak and clip hold. At most one draw per frame, never one per
 * screen refresh, and none at all once every meter has settled: the Volt sends reports in silence
 * too. Each meter is written only when it moves by a whole pixel, on its cover alone (so only the
 * cover's style is worked out again), and nothing is drawn while no one can see the page (the
 * engine doesn't even read the reports then).
 */

interface IMeterParts {
    meter: HTMLElement;
    cover: HTMLElement | null;
    name: string;
    /** Its length in CSS pixels: a level is drawn to the nearest one. */
    length: number;
}

const clipHoldMs = 2000;
const shown = new Map<string, number>();
const clippedUntil = new Map<string, number>();
/** What each meter element last showed, so an unchanged one isn't written again. */
const written = new WeakMap<HTMLElement, string>();
/** The page's meters, found again when the strips change (findMeters). */
let meters: IMeterParts[] | null = null;

const partsOf = (meter: HTMLElement): IMeterParts => {
    const isVertical = meter.dataset["orientation"] !== "horizontal";
    const bar = meter.querySelector<HTMLElement>(".bar");
    const length = (isVertical ? bar?.offsetHeight : bar?.offsetWidth) ?? 0;
    return { meter, cover: meter.querySelector<HTMLElement>(".cover"), name: meter.dataset["meter"] ?? "", length };
};

/** The strips were rebuilt (or the page laid out again): the meters are found and measured anew. */
export const findMeters = (): void => {
    meters = null;
};

const meterParts = (): IMeterParts[] =>
    (meters ??= [...document.querySelectorAll<HTMLElement>("[data-meter]")].map(partsOf).filter(({ name }) => name));

let frame = 0;
let drawnAt = performance.now();
/** Something on a meter was still lit at the last frame: a peak falling, or a clip light to put out. */
let isLit = false;

/** Writes one meter; true while it still has something to show (a level, or a clip light). */
const drawMeter = ({ meter, cover, name, length }: IMeterParts, now: number): boolean => {
    const fill = meterFill(shown.get(name) ?? -Infinity);
    const steps = Math.max(length, 1);
    const drawn = Math.round(fill * steps) / steps;
    const isClipped = (clippedUntil.get(name) ?? 0) > now;
    const text = `${drawn}:${isClipped}`;
    if (written.get(meter) !== text) {
        written.set(meter, text);
        (cover ?? meter).style.setProperty("--meter-level", drawn.toFixed(4));
        meter.toggleAttribute("data-clipped", isClipped);
    }
    return fill > 0 || isClipped;
};

/** The held peaks fall at the same speed however often frames are drawn. */
const fallPeaks = (now: number): void => {
    const fall = (peakFallDbPerSecond * Math.min(now - drawnAt, 100)) / 1000;
    for (const [name, db] of shown) shown.set(name, db - fall);
    drawnAt = now;
};

const draw = (now: number): void => {
    frame = 0;
    isLit = false;
    for (const parts of meterParts()) if (drawMeter(parts, now)) isLit = true;
    fallPeaks(now);
};

/** New peak levels: drawn in the next frame, if anything is (or was) lit. */
export const showMeterLevels = ({ names, levels }: IMeterFrame): void => {
    const now = performance.now();
    let hasLevel = isLit;
    names.forEach((name, i) => {
        const db = levels[i] ?? -Infinity;
        if (db > (shown.get(name) ?? -Infinity)) shown.set(name, db);
        if (db >= clipDb) clippedUntil.set(name, now + clipHoldMs);
        if (meterFill(db) > 0) hasLevel = true;
    });
    if (hasLevel) frame ||= requestAnimationFrame(draw);
};

/** Empties every meter (disconnected, or shown again after a while unseen). */
export const resetMeters = (): void => {
    shown.clear();
    clippedUntil.clear();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    drawnAt = performance.now();
    draw(drawnAt);
};
