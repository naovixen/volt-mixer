import { describe, expect, test } from "vitest";
import { homeAddresses, refusalFor } from "./phone-rules.ts";

const served = "192.168.1.20:48190";
const fromPhone = { host: served, origin: undefined, remoteIp: "192.168.1.31" };

const net = (address: string) => ({
    address,
    family: "IPv4" as const,
    internal: false,
    netmask: "255.255.255.0",
    mac: "00:00:00:00:00:00",
    cidr: null,
});

describe("Using refusalFor, when a phone on the home network asks", () => {
    test("then it should let it through", () => {
        expect(refusalFor(fromPhone, served)).toBe(0);
    });
});

describe("Using refusalFor, when the Host is another name (DNS rebinding)", () => {
    test("then it should refuse it with 421", () => {
        expect(refusalFor({ ...fromPhone, host: "attacker.example:48190" }, served)).toBe(421);
    });
});

describe("Using refusalFor, when the caller isn't on a private network", () => {
    test("then it should refuse it with 403", () => {
        expect(refusalFor({ ...fromPhone, remoteIp: "8.8.8.8" }, served)).toBe(403);
    });
});

describe("Using refusalFor, when another site's page calls", () => {
    test("then it should refuse it with 403", () => {
        expect(refusalFor({ ...fromPhone, origin: "https://attacker.example" }, served)).toBe(403);
    });
});

describe("Using homeAddresses, when there's Wi-Fi and a virtual switch", () => {
    test("then it should offer only the Wi-Fi", () => {
        const found = homeAddresses({ "Wi-Fi": [net("192.168.1.20")], "vEthernet (WSL)": [net("172.20.0.1")] });
        expect(found.map((entry) => entry.name)).toEqual(["Wi-Fi"]);
    });
});

describe("Using homeAddresses, when every adapter looks virtual", () => {
    test("then it should offer them rather than none", () => {
        expect(homeAddresses({ "vEthernet (WSL)": [net("172.20.0.1")] })).toHaveLength(1);
    });
});

describe("Using homeAddresses, when there's a 10.x and a 192.168.x network", () => {
    test("then it should put 192.168.x first", () => {
        const found = homeAddresses({ Ethernet: [net("10.0.0.5")], "Wi-Fi": [net("192.168.1.20")] });
        expect(found[0]?.address).toBe("192.168.1.20");
    });
});
