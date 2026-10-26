import type { IVoltEngine } from "../lib/engine/engine.ts";

/* Only one tab or window of the site drives the Volt; any other stays read-only and waits its turn. */

const lockName = "volt-mixer-control";

/** This tab drives the Volt from now on, until it closes (the lock is held for good). */
const takeControl = (engine: IVoltEngine): Promise<void> => {
    engine.setControl(true);
    return new Promise<void>(() => {});
};

/**
 * Takes the lock, or waits for it; without Web Locks there's no telling, so this tab drives.
 * Resolves once it's known which: in control, or waiting.
 */
export const holdControlLock = (engine: IVoltEngine): Promise<void> =>
    new Promise((decided) => {
        const locks = navigator.locks as LockManager | undefined;
        if (!locks) return void (takeControl(engine), decided());
        void locks.request(lockName, { ifAvailable: true }, (lock) => {
            if (!lock) {
                engine.setControl(false);
                void locks.request(lockName, () => takeControl(engine));
            }
            decided();
            return lock ? takeControl(engine) : undefined;
        });
    });
