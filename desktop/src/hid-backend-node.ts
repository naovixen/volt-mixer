import { HIDAsync, devicesAsync } from "node-hid";
import { protocol } from "../../src/lib/spec.ts";
import type { IHidBackend, IHidHandle, IHidInfo } from "./hid-transport.ts";

/*
 * The real Volt, through node-hid. Opened shared (nonExclusive), as UAD Console and a browser may
 * have it open too. Only UA's vendor ID is listed, so nothing else on the computer is touched.
 */

const toInfo = (device: Awaited<ReturnType<typeof devicesAsync>>[number]): IHidInfo | null =>
    device.path
        ? {
              path: device.path,
              vendorId: device.vendorId,
              productId: device.productId,
              usagePage: device.usagePage ?? 0,
          }
        : null;

const wrap = (device: HIDAsync): IHidHandle => ({
    write: async (bytes) => void (await device.write(bytes)),
    onData: (listen) => void device.on("data", (data: Buffer) => listen(new Uint8Array(data))),
    onError: (listen) => void device.on("error", listen),
    close: () => device.close(),
});

export const nodeHidBackend: IHidBackend = {
    list: async () =>
        (await devicesAsync())
            .filter((device) => device.vendorId === protocol.vendorId)
            .map(toInfo)
            .filter((info): info is IHidInfo => info !== null),
    open: async (info) => wrap(await HIDAsync.open(info.path, { nonExclusive: true })),
};
