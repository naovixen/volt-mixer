import { describe, expect, test } from "vitest";
import { isNewer } from "./versions.ts";

describe("Using isNewer, when the release is a patch ahead", () => {
    test("then it should count as newer", () => {
        expect(isNewer("v0.2.1", "0.2.0")).toBe(true);
    });
});

describe("Using isNewer, when a part has two digits", () => {
    test("then it should compare it as a number", () => {
        expect(isNewer("0.10.0", "0.9.0")).toBe(true);
    });
});

describe("Using isNewer, when the release is the version running", () => {
    test("then it shouldn't count as newer", () => {
        expect(isNewer("v0.2.0", "0.2.0")).toBe(false);
    });
});
