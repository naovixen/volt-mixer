import { dragValue, sliderModel } from "../lib/slider-models.ts";
import type { ISliderModel } from "../lib/slider-models.ts";
import { newestSpec, type ISpec } from "../lib/spec.ts";

/*
 * Behaviour for the Slider component (role="slider"). A mouse or pen press on the track sets the
 * value there and drags on from it; a finger sets it only with a tap, so a swipe can scroll the
 * page. A press on the handle, or on the label, scale or value, drags from where it is, as far as
 * the pointer travels, and only the way it travels. Changes the user makes are announced with a
 * bubbling "slider-input" event carrying { name, value }.
 */

interface ISliderState {
    model: ISliderModel;
    /** The spec the model's ranges came from. */
    spec: ISpec;
    value: number;
}

/** How far a finger can move and still count as a tap, in CSS pixels. */
const tapSlop = 6;
const states = new WeakMap<HTMLElement, ISliderState>();
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
let spec = newestSpec();

/** Sliders take their ranges (the fader's maximum, the gain's) from the connected Volt's spec. */
export const useSliderSpec = (next: ISpec): void => {
    spec = next;
};

const stateOf = (control: HTMLElement): ISliderState => {
    const state = states.get(control);
    if (state && state.spec === spec) return state;
    const model = sliderModel(control.dataset["kind"] ?? "", spec);
    const fresh = { model, spec, value: state?.value ?? model.min };
    states.set(control, fresh);
    return fresh;
};

/* An attribute written with the value it has still costs a style pass, and a screen reader update. */
const setAttribute = (element: Element, name: string, value: string): void => {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
};

const render = (control: HTMLElement, state: ISliderState): void => {
    const { model, value } = state;
    control.parentElement?.style.setProperty("--slider-position", String(clamp01(model.toPosition(value))));
    setAttribute(control, "aria-valuemin", String(model.min));
    setAttribute(control, "aria-valuemax", String(model.max));
    setAttribute(control, "aria-valuenow", String(value));
    setAttribute(control, "aria-valuetext", model.speak(value));
    const readout = control.parentElement?.querySelector("[data-slider-value]");
    if (readout && readout.textContent !== model.format(value)) readout.textContent = model.format(value);
};

/** Read-only while the Volt can't be changed: the attribute is written only when that changes. */
export const setSliderDisabled = (control: HTMLElement, isDisabled: boolean): void =>
    setAttribute(control, "aria-disabled", String(isDisabled));

/** Shows a value that came from the page or the Volt; never announces it as a user change. */
export const setSliderValue = (control: HTMLElement, value: number): void => {
    const state = stateOf(control);
    const isShown = control.getAttribute("aria-valuemax") === String(state.model.max);
    if (state.value === value && isShown) return;
    state.value = value;
    render(control, state);
};

const change = (control: HTMLElement, value: number): void => {
    const state = stateOf(control);
    if (value === state.value || control.getAttribute("aria-disabled") === "true") return;
    setSliderValue(control, value);
    const detail = { name: control.dataset["slider"], value };
    control.dispatchEvent(new CustomEvent("slider-input", { bubbles: true, detail }));
};

const isVertical = (control: HTMLElement): boolean => control.getAttribute("aria-orientation") === "vertical";

/** Where the handle's centre is at 0, and how far it travels: the control less the handle (Slider.astro). */
const travelOf = (control: HTMLElement): { start: number; length: number } => {
    const rect = control.getBoundingClientRect();
    const thumb = control.querySelector(".thumb")?.getBoundingClientRect();
    if (isVertical(control)) {
        const size = thumb?.height ?? 0;
        return { start: rect.bottom - size / 2, length: rect.height - size || 1 };
    }
    const size = thumb?.width ?? 0;
    return { start: rect.left + size / 2, length: rect.width - size || 1 };
};

/** Where a press on the track lands, 0–1. */
const positionAt = (control: HTMLElement, event: PointerEvent): number => {
    const { start, length } = travelOf(control);
    return clamp01((isVertical(control) ? start - event.clientY : event.clientX - start) / length);
};

const isOnTrack = (control: HTMLElement, event: PointerEvent): boolean => {
    const target = event.target as Element;
    return control.contains(target) && !target.closest(".thumb");
};

interface IPointerHandlers {
    onMove: (move: PointerEvent) => void;
    /** Released (not cancelled: a cancel is the browser taking the gesture, to scroll). */
    onUp: (up: PointerEvent) => void;
}

/** Follows the pointer that pressed, and only that one, until it's released or the browser takes it. */
const followPointer = (control: HTMLElement, pointerId: number, { onMove, onUp }: IPointerHandlers): void => {
    // For styling: a value readout can show only while the handle is held.
    control.toggleAttribute("data-dragging", true);
    const isOurs = (event: PointerEvent): boolean => event.pointerId === pointerId;
    const move = (event: PointerEvent): void => void (isOurs(event) && onMove(event));
    const end = (event: PointerEvent): void => {
        if (!isOurs(event)) return;
        control.removeAttribute("data-dragging");
        control.removeEventListener("pointermove", move);
        control.removeEventListener("pointerup", end);
        control.removeEventListener("pointercancel", end);
        if (event.type === "pointerup") onUp(event);
    };
    control.addEventListener("pointermove", move);
    control.addEventListener("pointerup", end);
    control.addEventListener("pointercancel", end);
};

const pointerAlong = (control: HTMLElement, event: PointerEvent): number =>
    isVertical(control) ? -event.clientY : event.clientX;

/** Starts a drag of `control`; a press on the track sets it there first (a finger's, only as a tap). */
const startDrag = (control: HTMLElement, event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary) return;
    // Stops the browser starting a text selection or drag, which would cancel this one.
    if (event.pointerType !== "touch") event.preventDefault();
    const isTouch = event.pointerType === "touch";
    const isTrackPress = isOnTrack(control, event);
    if (isTrackPress && !isTouch) change(control, stateOf(control).model.fromPosition(positionAt(control, event)));
    const { length } = travelOf(control);
    const start = { pointer: pointerAlong(control, event), x: event.clientX, y: event.clientY };
    const value = stateOf(control).value;
    control.setPointerCapture(event.pointerId);
    control.focus();
    followPointer(control, event.pointerId, {
        onMove: (move) => {
            const { model } = stateOf(control);
            const travel = (pointerAlong(control, move) - start.pointer) / length;
            change(control, dragValue(model, value, clamp01(model.toPosition(value) + travel)));
        },
        onUp: (up) => {
            const isTap = Math.hypot(up.clientX - start.x, up.clientY - start.y) < tapSlop;
            if (isTouch && isTrackPress && isTap)
                change(control, stateOf(control).model.fromPosition(positionAt(control, up)));
        },
    });
};

/** End goes to the rest point on faders (0 dB) and the end on pan; never to a loud maximum. */
const keyTarget = (key: string, control: HTMLElement): number | null => {
    const { model, value } = stateOf(control);
    const kind = control.dataset["kind"];
    const steps: Record<string, () => number | null> = {
        ArrowUp: () => model.step(value, 1, false),
        ArrowRight: () => model.step(value, 1, false),
        ArrowDown: () => model.step(value, -1, false),
        ArrowLeft: () => model.step(value, -1, false),
        PageUp: () => model.step(value, 1, true),
        PageDown: () => model.step(value, -1, true),
        Home: () => model.min,
        End: () => (kind === "fader" ? model.rest : kind === "pan" ? model.max : null),
    };
    return steps[key]?.() ?? null;
};

const onKeyDown = (event: KeyboardEvent): void => {
    const control = event.currentTarget as HTMLElement;
    const target = keyTarget(event.key, control);
    if (target === null) return;
    event.preventDefault();
    change(control, target);
};

/** The wheel only moves a focused slider, so scrolling the page can't change a level. */
const onWheel = (event: WheelEvent): void => {
    const control = event.currentTarget as HTMLElement;
    if (document.activeElement !== control) return;
    event.preventDefault();
    const { model, value } = stateOf(control);
    change(control, model.step(value, event.deltaY < 0 ? 1 : -1, false));
};

const bound = new WeakSet<HTMLElement>();

/** Wires up every slider under `root` (safe to call again after adding strips). */
export const initSliders = (root: ParentNode): void => {
    for (const control of root.querySelectorAll<HTMLElement>("[data-slider]")) {
        if (bound.has(control)) continue;
        bound.add(control);
        render(control, stateOf(control));
        const area = control.parentElement ?? control;
        area.addEventListener("pointerdown", (event) => startDrag(control, event));
        area.addEventListener("dragstart", (event) => event.preventDefault());
        control.addEventListener("keydown", onKeyDown);
        control.addEventListener("wheel", onWheel, { passive: false });
        control.addEventListener("dblclick", () => change(control, stateOf(control).model.rest));
    }
};
