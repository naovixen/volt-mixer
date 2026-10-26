import { describe, expect, test } from "vitest";
import { mergeLegacy, readStoreData } from "./store-file.ts";

describe("Using the store, when the page hands over a mix the file doesn't have", () => {
    test("then it should take it", () => {
        const data = readStoreData({});
        mergeLegacy(data, { mixes: { V1: { version: 1 } } }, true);
        expect(data.mixes["V1"]).toEqual({ version: 1 });
    });
});

describe("Using the store, when the page hands over a mix the file already has", () => {
    test("then it should keep the file's", () => {
        const data = readStoreData({ mixes: { V1: { version: 1, kept: true } } });
        mergeLegacy(data, { mixes: { V1: { version: 1 } } }, false);
        expect(data.mixes["V1"]).toEqual({ version: 1, kept: true });
    });
});

describe("Using the store, when the page hands over a view to a file that isn't new", () => {
    test("then it should keep the file's view", () => {
        const data = readStoreData({ view: { isDigitalShown: true } });
        mergeLegacy(data, { view: { isDigitalShown: false } }, false);
        expect(data.view.isDigitalShown).toBe(true);
    });
});

describe("Using the store, when the page hands over a brightness out of range", () => {
    test("then it should leave it out", () => {
        const data = readStoreData({});
        mergeLegacy(data, { brightness: { V1: 900 } }, true);
        expect(data.brightness["V1"]).toBeUndefined();
    });
});

describe("Using the store, when its file holds something that isn't a view", () => {
    test("then it should start from Console's view", () => {
        expect(readStoreData({ view: "loud" }).view).toEqual({ isDigitalShown: false, isLoopbackShown: true });
    });
});
