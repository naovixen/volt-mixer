/*
 * Whether anyone can see the mixer page, from the Page Visibility API. The meters and views draw
 * only while the page is seen, and catch up when it's shown again. (The desktop app closes its
 * window when it goes to the tray, so there it's the same.)
 */

const listeners = new Set<(isShown: boolean) => void>();

export const isPageShown = (): boolean => document.visibilityState === "visible";

/** `listen` runs each time the page is shown or hidden. */
export const onPageVisibility = (listen: (isShown: boolean) => void): void => void listeners.add(listen);

export const wirePageVisibility = (): void => {
    document.addEventListener("visibilitychange", () => listeners.forEach((listen) => listen(isPageShown())));
};
