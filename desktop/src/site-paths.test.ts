import path from "path";
import { describe, expect, test } from "vitest";
import { fileWithin } from "./site-paths.ts";

const root = path.resolve("site");

describe("Using fileWithin, when the path is a folder", () => {
    test("then it should serve its index.html", () => {
        expect(fileWithin(root, "/tray/")).toBe(path.join(root, "tray", "index.html"));
    });
});

describe("Using fileWithin, when the path climbs out of the site", () => {
    test("then it should refuse it", () => {
        expect(fileWithin(root, "/../package.json")).toBeNull();
    });
});

describe("Using fileWithin, when the climb is percent-encoded", () => {
    test("then it should refuse it", () => {
        expect(fileWithin(root, "/%2e%2e/%2e%2e/secret.txt")).toBeNull();
    });
});

describe("Using fileWithin, when the encoding is broken", () => {
    test("then it should refuse it", () => {
        expect(fileWithin(root, "/%E0%A4%A")).toBeNull();
    });
});

describe("Using fileWithin, when a sibling folder starts with the site's name", () => {
    test("then it should refuse it", () => {
        expect(fileWithin(root, "/../site-other/index.html")).toBeNull();
    });
});
