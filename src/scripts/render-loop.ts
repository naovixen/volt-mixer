import { allChanges, mergeChanges, noChanges, type IChanges } from "../lib/engine/changes.ts";
import { isPageShown } from "./page-visibility.ts";

/*
 * The page draws at most once a frame, and only what changed since the last frame; nothing at
 * all while no one can see it (it catches up when shown, page-visibility.ts). The controller
 * says how to draw; anything can ask for a frame.
 */

let pending: IChanges = noChanges();
let frame = 0;
let draw = (_changes: IChanges): void => {};

const run = (): void => {
    frame = 0;
    if (!isPageShown()) return;
    const changes = pending;
    pending = noChanges();
    draw(changes);
};

export const setRenderer = (render: (changes: IChanges) => void): void => {
    draw = render;
};

/** Draws `changes` (everything when left out) in the next frame, or once the page is shown. */
export const requestRender = (changes: IChanges = allChanges()): void => {
    mergeChanges(pending, changes);
    if (isPageShown()) frame ||= requestAnimationFrame(run);
};
